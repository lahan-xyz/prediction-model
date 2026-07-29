import { EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA } from './league_stats.js';

// ============================================
// Football Prediction Model — Optimized & Corrected
// ============================================

// ============================================
// CONFIG — centralized tuning
// ============================================

const MODEL_CONFIG = {
  // Form weighting
  formDecay: 0.85,
  seasonWeight: 0.7,
  formWeight: 0.3,

  // Expected Goals adjustments
  strengthDiffMultiplier: 0.08,
  defenseSuppressionFactor: 0.12,
  defenseSuppressionCap: 0.5,
  lowTempoThreshold: 2.6,
  lowTempoMultiplier: 0.92,
  highTempoThreshold: 3.4,
  highTempoMultiplier: 1.05,
  leagueNormWeight: 0.1,

  // Asymmetry
  asymmetryBoost: 1.05,
  asymmetryPenalty: 0.95,  // NEW: symmetric away penalty
  travelSicknessThreshold: 0.5,  // CHANGED: was 0.3, too permissive

  // Lambda3 (goal correlation) — bivariate Poisson
  lambda3Base: 0.04,
  lambda3Slope: 0.03,
  lambda3Min: 0.03,
  lambda3Max: 0.18,

  // Post-adjustments for BTTS
  bttsLowTempoPenalty: 0.92,
  bttsImbalancePenalty: 0.9,
  bttsImbalanceThreshold: 0.8,
  bttsLowTempoThreshold: 3.0,

  // Grid computation
  maxGoalsDeterministic: 10,

  // xG clamping
  xGMin: 0.3,
  xGMax: 3.2,

  // Attack floor
  attackFloor: 0.1
};


const CALIB_CONFIG = {
  highXGThreshold: 3.2,
  highXGDecay: 0.92,  // Probability shrink factor, not logit multiplier

  tightXGDiff: 0.4,
  tightXGDrawBoost: 0.25,

  openGameThreshold: 3.6,
  openGameDrawPenalty: 0.2,

  strongDominationDiff: 0.5,
  homeDominationBoost: 0.3,
  awayDominationBoost: 0.2
};


const LEAGUE_STRENGTH = {
  "EPL": 1.000,
  "La Liga": 0.929,
  "Bundesliga": 0.921,
  "Serie A": 0.911,
  "Ligue 1": 0.909
};


// ============================================
// League Registry — replaces global LEAGUE mutation
// ============================================

const LEAGUES = [EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA];
const LEAGUE_MAP = new Map();  // teamName -> { league, data }

// Build lookup map once at module load
function buildLeagueMap() {
  for (const league of LEAGUES) {
    if (!league || !league.leagueName) continue;
    for (const [teamName, data] of Object.entries(league)) {
      if (teamName === 'leagueName' || teamName === 'leagueAverageXG') continue;
      if (typeof data === 'object' && data !== null) {
        LEAGUE_MAP.set(teamName, {
          leagueName: league.leagueName,
          leagueAvgXG: league.leagueAverageXG,
          data
        });
      }
    }
  }
}

buildLeagueMap();


// ============================================
// Math Utilities
// ============================================

const EPS = 1e-15;

function logit(p) {
  const clamped = Math.max(EPS, Math.min(1 - EPS, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x) {
  // More generous threshold to avoid truncating valid logits
  if (x > 40) return 1;
  if (x < -40) return 0;
  return 1 / (1 + Math.exp(-x));
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Poisson PMF. k must be non-negative integer.
 * Uses iterative multiplication to avoid factorial overflow.
 */
function poisson(lambda, k) {
  if (lambda <= 0 || k < 0) return 0;
  k = Math.floor(k);
  if (k === 0) return Math.exp(-lambda);

  let prob = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    prob *= lambda / i;
  }
  return prob;
}

/**
 * Exponentially weighted moving average.
 * ASSUMES: arr[0] is OLDEST, arr[arr.length-1] is NEWEST.
 * Most recent match gets weight = 1, older matches decay by formDecay.
 * 
 * CRITICAL FIX: If your data has arr[0] as NEWEST, reverse the array
 * before passing, or change the loop direction.
 */
function weightedAverage(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;

  let sum = 0;
  let totalWeight = 0;
  let currentWeight = 1;

  // arr[arr.length - 1] = newest → gets weight 1
  for (let i = arr.length - 1; i >= 0; i--) {
    const val = Number(arr[i]);
    if (!Number.isFinite(val)) continue;  // Skip NaN/undefined
    sum += val * currentWeight;
    totalWeight += currentWeight;
    currentWeight *= MODEL_CONFIG.formDecay;
  }

  return totalWeight > 0 ? sum / totalWeight : 0;
}


// ============================================
// Team Data Lookup — no global state mutation
// ============================================

const MISSING_TEAMS = new Set();

function getTeamData(teamName) {
  const entry = LEAGUE_MAP.get(teamName);
  if (!entry) {
    MISSING_TEAMS.add(teamName);
    return null;
  }
  return entry;
}

function getMissingTeams() {
  return Array.from(MISSING_TEAMS);
}

function clearMissingTeams() {
  MISSING_TEAMS.clear();
}


// ============================================
// Expected Goals Calculation
// ============================================

/**
 * Calculates xG for a team in a specific matchup.
 * @param {string} subjectName - Team to predict goals for
 * @param {string} opponentName - Opponent team
 * @param {boolean} isSubjectHome - Whether subject plays at home
 * @param {boolean} isNeutral - Neutral venue (default: false)
 * @returns {number|null} Expected goals, or null if data missing
 */
function calculateExpectedGoals(subjectName, opponentName, isSubjectHome, isNeutral = false) {
  // 1. Data acquisition
  const subjectInfo = getTeamData(subjectName);
  const opponentInfo = getTeamData(opponentName);

  if (!subjectInfo || !opponentInfo) return null;

  const { data: subject, leagueAvgXG: subjectLeagueAvg, leagueName: subjectLeague } = subjectInfo;
  const { data: opponent, leagueAvgXG: oppLeagueAvg, leagueName: oppLeague } = opponentInfo;

  // 2. League average safeguard
  // FIX: Removed arbitrary halving. League average xG should be per-team per-match (~1.3-1.5).
  // If your league stats store TOTAL match xG (both teams), divide by 2 in the data source, not here.
  let teamLeagueAvg = (subjectLeagueAvg + oppLeagueAvg) / 2;
  teamLeagueAvg = Math.max(0.1, teamLeagueAvg);

  // 3. Contextual base stats
  const seasonAttack = isNeutral
    ? (subject.homeXG + subject.awayXG) / 2
    : isSubjectHome ? subject.homeXG : subject.awayXG;

  const seasonDefense = isNeutral
    ? (opponent.homeXGA + opponent.awayXGA) / 2
    : isSubjectHome ? opponent.awayXGA : opponent.homeXGA;

  // 4. Recent form (EWMA)
  const recentAttack = weightedAverage(subject.last6XG);
  const recentDefense = weightedAverage(opponent.last6XGA);

  // 5. Blend season + form
  const blendedAttack = Math.max(
    MODEL_CONFIG.attackFloor,
    (seasonAttack * MODEL_CONFIG.seasonWeight) + (recentAttack * MODEL_CONFIG.formWeight)
  );
  const blendedDefense = Math.max(
    MODEL_CONFIG.attackFloor,
    (seasonDefense * MODEL_CONFIG.seasonWeight) + (recentDefense * MODEL_CONFIG.formWeight)
  );

  // 6. Core interaction: relative strength
  let baseXG = (blendedAttack * blendedDefense) / teamLeagueAvg;

  // 7. Strength difference modifier (capped to prevent extreme values)
  const strengthDiff = blendedAttack - blendedDefense;
  const cappedDiff = clamp(strengthDiff, -1, 1);
  baseXG *= (1 + MODEL_CONFIG.strengthDiffMultiplier * cappedDiff);

  // 8. Tempo adjustment (match pace)
  const subjectTempo = (subject.homeXG + subject.homeXGA + subject.awayXG + subject.awayXGA) / 2;
  const opponentTempo = (opponent.homeXG + opponent.homeXGA + opponent.awayXG + opponent.awayXGA) / 2;
  const matchTempo = (subjectTempo + opponentTempo) / 2;

  if (matchTempo < MODEL_CONFIG.lowTempoThreshold) baseXG *= MODEL_CONFIG.lowTempoMultiplier;
  if (matchTempo > MODEL_CONFIG.highTempoThreshold) baseXG *= MODEL_CONFIG.highTempoMultiplier;

  // 9. League normalization (regression toward mean)
  baseXG = (baseXG * (1 - MODEL_CONFIG.leagueNormWeight)) + (teamLeagueAvg * MODEL_CONFIG.leagueNormWeight);

  // 10. Asymmetry (home advantage / travel sickness)
  if (!isNeutral) {
    if (isSubjectHome) {
      // Home team: boost if opponent struggles away
      const travelSickness = opponent.awayXGA - opponent.homeXGA;
      if (travelSickness > MODEL_CONFIG.travelSicknessThreshold) {
        baseXG *= MODEL_CONFIG.asymmetryBoost;
      }
    } else {
      // Away team: penalty if opponent defends well at home
      const homeFortress = opponent.homeXGA - opponent.awayXGA;
      if (homeFortress < -MODEL_CONFIG.travelSicknessThreshold) {
        baseXG *= MODEL_CONFIG.asymmetryPenalty;
      }
    }
  }

  // 11. Cross-league adjustment
  if (subjectLeague !== oppLeague) {
    const subjStrength = LEAGUE_STRENGTH[subjectLeague] ?? 1.0;
    const oppStrength = LEAGUE_STRENGTH[oppLeague] ?? 1.0;
    // Adjust relative to opponent league strength
    baseXG *= (subjStrength / oppStrength);
  }

  // 12. Final clamp
  return clamp(baseXG, MODEL_CONFIG.xGMin, MODEL_CONFIG.xGMax);
}


// ============================================
// Correlation (Bivariate Poisson λ3)
// ============================================

function calculateLambda3(homeXG, awayXG) {
  const total = homeXG + awayXG;
  // FIX: Prevent negative lambda before clamping for low-xG matches
  const lambda = MODEL_CONFIG.lambda3Base + MODEL_CONFIG.lambda3Slope * Math.max(0, total - 2);
  return clamp(lambda, MODEL_CONFIG.lambda3Min, MODEL_CONFIG.lambda3Max);
}


// ============================================
// Calibration — FIXED logit manipulation
// ============================================

/**
 * Shrinks a probability toward 0.5 by a given factor.
 * factor = 0.92 means "reduce distance from 0.5 by 8%".
 */
function shrinkProbability(p, factor) {
  return 0.5 + (p - 0.5) * factor;
}

/**
 * Calibrates baseline 1X2 odds based on game state dynamics.
 * Operates in probability space, not logit space, for intuitive adjustments.
 */
function calibrate1X2(homeWin, draw, awayWin, homeXG, awayXG) {
  const totalXG = homeXG + awayXG;
  const diffXG = homeXG - awayXG;

  // --- Convert to probability space for intuitive adjustments ---
  let h = homeWin;
  let d = draw;
  let a = awayWin;

  // 1. Reduce overconfidence in high xG games (shrink toward 0.5)
  if (totalXG > CALIB_CONFIG.highXGThreshold) {
    h = shrinkProbability(h, CALIB_CONFIG.highXGDecay);
    a = shrinkProbability(a, CALIB_CONFIG.highXGDecay);
  }

  // 2. Boost draws in balanced games (additive in logit space = multiplicative in odds)
  if (Math.abs(diffXG) < CALIB_CONFIG.tightXGDiff) {
    const drawLogit = logit(d);
    d = sigmoid(drawLogit + CALIB_CONFIG.tightXGDrawBoost);
  }

  // 3. Reduce draws in very open games
  if (totalXG > CALIB_CONFIG.openGameThreshold) {
    const drawLogit = logit(d);
    d = sigmoid(drawLogit - CALIB_CONFIG.openGameDrawPenalty);
  }

  // 4. Bias toward stronger side
  if (diffXG > CALIB_CONFIG.strongDominationDiff) {
    const homeLogit = logit(h);
    h = sigmoid(homeLogit + CALIB_CONFIG.homeDominationBoost);
  } else if (diffXG < -CALIB_CONFIG.strongDominationDiff) {
    const awayLogit = logit(a);
    a = sigmoid(awayLogit + CALIB_CONFIG.awayDominationBoost);
  }

  // --- Normalize ---
  const sum = h + d + a;

  return {
    homeWin: h / sum,
    draw: d / sum,
    awayWin: a / sum
  };
}


// ============================================
// Odds Conversion
// ============================================

function toOdds(probability) {
  if (probability <= 0 || probability > 1) return null;
  return Number((1 / probability).toFixed(2));
}


// ============================================
// Match Prediction — Deterministic Grid
// ============================================

/**
 * Predicts a football match using an exact deterministic grid.
 * Eliminates Monte Carlo sampling noise.
 * 
 * @param {string} home - Home team name
 * @param {string} away - Away team name
 * @param {string} leagueName - League name for labeling (optional)
 * @param {boolean} isNeutral - Neutral venue (default: false)
 * @returns {object|null} Prediction result
 */
function predictMatch(home, away, leagueName = null, isNeutral = false) {
  // FIX: Correct parameter order — only 4 args to calculateExpectedGoals
  const homeXG = calculateExpectedGoals(home, away, true, isNeutral);
  const awayXG = calculateExpectedGoals(away, home, false, isNeutral);

  if (homeXG == null || awayXG == null) return null;

  const lambda3 = calculateLambda3(homeXG, awayXG);
  const totalXG = homeXG + awayXG;

  let under15 = 0;
  let under25 = 0;
  let under35 = 0;
  let btts = 0;
  let _homeWin = 0;
  let _draw = 0;
  let _awayWin = 0;
  let totalMass = 0;

  const MAX_GOALS = MODEL_CONFIG.maxGoalsDeterministic;
  const scorelinesList = [];

  // Pre-calculate Poisson distributions
  const homePoissonCache = new Float64Array(MAX_GOALS + 1);
  const awayPoissonCache = new Float64Array(MAX_GOALS + 1);
  const l3PoissonCache = new Float64Array(MAX_GOALS + 1);

  for (let i = 0; i <= MAX_GOALS; i++) {
    homePoissonCache[i] = poisson(homeXG, i);
    awayPoissonCache[i] = poisson(awayXG, i);
    l3PoissonCache[i] = poisson(lambda3, i);
  }

  // Deterministic grid
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      let prob = 0;
      const maxK = Math.min(h, a);

      for (let k = 0; k <= maxK; k++) {
        prob += homePoissonCache[h - k] * awayPoissonCache[a - k] * l3PoissonCache[k];
      }

      totalMass += prob;

      if (h + a <= 1) under15 += prob;
      if (h + a <= 2) under25 += prob;
      if (h + a <= 3) under35 += prob;

      if (h >= 1 && a >= 1) btts += prob;

      if (h > a) _homeWin += prob;
      else if (h === a) _draw += prob;
      else _awayWin += prob;

      scorelinesList.push({ score: `${h}-${a}`, prob });
    }
  }

  // Normalize truncation error
  if (totalMass <= 0) return null;  // Guard against division by zero

  _homeWin /= totalMass;
  _draw /= totalMass;
  _awayWin /= totalMass;
  under15 /= totalMass;
  under25 /= totalMass;
  under35 /= totalMass;
  btts /= totalMass;

  for (const sl of scorelinesList) {
    sl.prob /= totalMass;
  }

  // Calibrate 1X2
  const { homeWin, draw, awayWin } = calibrate1X2(_homeWin, _draw, _awayWin, homeXG, awayXG);

  // BTTS heuristic adjustments
  const imbalance = Math.abs(homeXG - awayXG);

  let adjustedBtts = btts;
  if (totalXG < MODEL_CONFIG.bttsLowTempoThreshold) {
    adjustedBtts *= MODEL_CONFIG.bttsLowTempoPenalty;
  }
  if (imbalance > MODEL_CONFIG.bttsImbalanceThreshold) {
    adjustedBtts *= MODEL_CONFIG.bttsImbalancePenalty;
  }

  // Top 3 scorelines
  const topScorelines = scorelinesList
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3)
    .map(item => ({
      score: item.score,
      probability: toOdds(item.prob),
      rawProbability: Number(item.prob.toFixed(4))  // Added for transparency
    }));

  // Resolve league name without global mutation
  const homeData = getTeamData(home);
  const resolvedLeague = leagueName || (homeData?.leagueName ?? 'Unknown');

  return {
    match: { homeTeam: home, awayTeam: away },
    league: resolvedLeague,
    xG: {
      home: Number(homeXG.toFixed(2)),
      away: Number(awayXG.toFixed(2)),
      total: Number(totalXG.toFixed(2))
    },
    correlation: Number(lambda3.toFixed(3)),
    probabilities: {  // NEW: raw probabilities for transparency
      homeWin: Number(homeWin.toFixed(4)),
      draw: Number(draw.toFixed(4)),
      awayWin: Number(awayWin.toFixed(4)),
      over15: Number((1 - under15).toFixed(4)),
      under15: Number(under15.toFixed(4)),
      over25: Number((1 - under25).toFixed(4)),
      under25: Number(under25.toFixed(4)),
      over35: Number((1 - under35).toFixed(4)),
      under35: Number(under35.toFixed(4)),
      btts: Number(adjustedBtts.toFixed(4)),
      bttsNo: Number((1 - adjustedBtts).toFixed(4))
    },
    odds: {
      over15: toOdds(1 - under15),
      under15: toOdds(under15),
      over25: toOdds(1 - under25),
      under25: toOdds(under25),
      over35: toOdds(1 - under35),
      under35: toOdds(under35),
      gg: toOdds(adjustedBtts),
      ng: toOdds(1 - adjustedBtts),
      homeWin: toOdds(homeWin),
      draw: toOdds(draw),
      awayWin: toOdds(awayWin)
    },
    topScorelines
  };
}


// ============================================
// ROI / Edge Computation — Enhanced
// ============================================

const EDGE_THRESHOLD = 0.05;  // 5% edge threshold for "value"

function computeROI(data) {
  const { odds, oneX2, OU15, OU25, OU35, BTTS } = data;

  const groups = [
    {
      source: oneX2,
      mappings: [
        { outKey: 'homeWin', marketKey: 'Home', predKey: 'homeWin' },
        { outKey: 'draw', marketKey: 'Draw', predKey: 'draw' },
        { outKey: 'awayWin', marketKey: 'Away', predKey: 'awayWin' }
      ]
    },
    {
      source: OU15,
      mappings: [
        { outKey: 'over15', marketKey: 'Over', predKey: 'over15' },
        { outKey: 'under15', marketKey: 'Under', predKey: 'under15' }
      ]
    },
    {
      source: OU25,
      mappings: [
        { outKey: 'over25', marketKey: 'Over', predKey: 'over25' },
        { outKey: 'under25', marketKey: 'Under', predKey: 'under25' }
      ]
    },
    {
      source: OU35,
      mappings: [
        { outKey: 'over35', marketKey: 'Over', predKey: 'over35' },
        { outKey: 'under35', marketKey: 'Under', predKey: 'under35' }
      ]
    },
    {
      source: BTTS,
      mappings: [
        { outKey: 'bttsYes', marketKey: 'BTTS', predKey: 'gg' },
        { outKey: 'bttsNo', marketKey: 'BTTSN', predKey: 'ng' }
      ]
    }
  ];

  const result = {};

  for (const group of groups) {
    if (!group.source) continue;

    for (const m of group.mappings) {
      const predOdds = odds[m.predKey];
      const marketOdds = parseFloat(group.source[m.marketKey]);

      if (predOdds != null && predOdds > 0 && marketOdds > 0) {
        // Edge = (market_odds / fair_odds) - 1
        // Positive = market offers better than fair value
        const edge = (marketOdds / predOdds) - 1;
        result[m.outKey] = {
          edge: Number(edge.toFixed(3)),
          marketOdds,
          predictedOdds: predOdds,
          value: edge > EDGE_THRESHOLD ? 'value' : edge < -EDGE_THRESHOLD ? 'avoid' : 'neutral'
        };
      } else {
        result[m.outKey] = null;
      }
    }
  }

  // Pairwise comparisons for binary markets
  const binaryPairs = [
    ['over15', 'under15'],
    ['over25', 'under25'],
    ['over35', 'under35'],
    ['bttsYes', 'bttsNo']
  ];

  for (const [aKey, bKey] of binaryPairs) {
    const a = result[aKey];
    const b = result[bKey];
    if (a && b) {
      // Use value classification instead of simple edge comparison
      a.hClass = a.value;
      b.hClass = b.value;
    }
  }

  // 1X2 comparison — all three outcomes
  if (result.homeWin && result.draw && result.awayWin) {
    const edges = [
      { key: 'homeWin', edge: result.homeWin.edge },
      { key: 'draw', edge: result.draw.edge },
      { key: 'awayWin', edge: result.awayWin.edge }
    ];

    const maxEdge = Math.max(...edges.map(e => e.edge));

    for (const { key, edge } of edges) {
      result[key].hClass = edge > EDGE_THRESHOLD ? 'value' : edge === maxEdge && edge > 0 ? 'best' : 'neutral';
    }
  }

  return result;
}


// ============================================
// Multi-Match Prediction — with concurrency
// ============================================

async function predictMultiMatch(fixtures) {
  if (!Array.isArray(fixtures)) {
    throw new TypeError('fixtures must be an array');
  }

  clearMissingTeams();

  // Process in batches to avoid blocking the event loop
  const BATCH_SIZE = 50;
  const outArr = [];

  for (let i = 0; i < fixtures.length; i += BATCH_SIZE) {
    const batch = fixtures.slice(i, i + BATCH_SIZE);

    const batchResults = batch.map(fixture => {
      try {
        const { homeTeam, awayTeam, league, isNeutral, country, startDate, markets } = fixture;

        if (!homeTeam || !awayTeam) {
          console.warn('Skipping fixture with missing team:', fixture);
          return null;
        }

        const { OverUnder, BTTS } = markets || {};
        const oneX2 = markets?.['1X2'];

        const OU15 = OverUnder?.['OU1.5'];
        const OU25 = OverUnder?.['OU2.5'];
        const OU35 = OverUnder?.['OU3.5'];

        // Format date
        let fullDate = null;
        if (startDate) {
          const [datePart, timePart] = startDate.split(' ');
          if (datePart) {
            const d = new Date(datePart);
            if (!Number.isNaN(d.getTime())) {
              fullDate = d.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
              if (timePart) {
                fullDate += ` (${timePart.slice(0, 5)})`;
              }
            }
          }
        }

        let prediction = predictMatch(homeTeam, awayTeam, league, isNeutral);

        if (!prediction) {
          console.warn(`Prediction failed for ${homeTeam} vs ${awayTeam}`);
          return null;
        }

        const withOdds = {
          ...prediction,
          fullDate,
          oneX2,
          OU15,
          OU25,
          OU35,
          BTTS
        };

        const edge = computeROI(withOdds);

        return {
          ...withOdds,
          ...edge
        };
      } catch (err) {
        console.error('Error processing fixture:', err);
        return null;
      }
    }).filter(Boolean);

    outArr.push(...batchResults);

    // Yield to event loop between batches
    if (i + BATCH_SIZE < fixtures.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  const missing = getMissingTeams();
  if (missing.length > 0) {
    console.warn('Teams not found in data:', missing);
  }

  return outArr;
}


// ============================================
// Fixture Fetching — parameterized
// ============================================

async function fetchFixtures(date = null, timezone = 'Africa/Lagos', ccode3 = 'NGA') {
  const targetDate = date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://www.fotmob.com/api/data/matches?date=${targetDate}&timezone=${encodeURIComponent(timezone)}&ccode3=${ccode3}&includeNextDayLateNight=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.leagues || [];
  } catch (err) {
    console.error('Failed to fetch fixtures:', err);
    return [];
  }
}


// ============================================
// Exports
// ============================================

export { 
  predictMatch, 
  predictMultiMatch, 
  fetchFixtures,
  calculateExpectedGoals,
  getTeamData,
  getMissingTeams,
  clearMissingTeams,
  MODEL_CONFIG,
  CALIB_CONFIG
};

export default predictMultiMatch;