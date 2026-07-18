import { EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA } from './league_stats.js';
// ============================================
// Football Prediction Model
// ============================================

const SIMULATIONS = 100000;

let LEAGUE = "";

// ============================================
// CONFIG — everything is now tunable in one place
// ============================================

const MODEL_CONFIG = {
  // Form weighting
  formDecay: 0.85,
  seasonWeight: 0.7, // Increased slightly for baseline stability
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
  
  // Lambda3 (goal correlation)
  lambda3Base: 0.04,
  lambda3Slope: 0.03,
  lambda3Min: 0.03,
  lambda3Max: 0.18,
  
  // Post-adjustments for BTTS
  bttsLowTempoPenalty: 0.92,
  bttsImbalancePenalty: 0.9,
  bttsImbalanceThreshold: 0.8,
  bttsLowTempoThreshold: 3.0,
  
  // Monte Carlo
  sharedImpact: 0.75,
  maxGoalsPerTeamMC: 8,
  
  // Deterministic loop
  maxGoalsDeterministic: 10,
  
  // xG clamping
  xGMin: 0.3,
  xGMax: 3.2
};


const CALIB_CONFIG = {
  highXGThreshold: 3.2,
  highXGDecay: 0.92,
  
  tightXGDiff: 0.4,
  tightXGDrawBoost: 0.25,
  
  openGameThreshold: 3.6,
  openGameDrawPenalty: 0.2,
  
  strongDominationDiff: 0.5,
  homeDominationBoost: 0.3,
  awayDominationBoost: 0.2 // I should monitor this!
};


const leagueStrength = {
  "EPL": 1.000,
  "La Liga": 0.929,
  "Bundesliga": 0.921,
  "Serie A": 0.911,
  "Ligue 1": 0.909
};


/**
 * Computes the log-odds of a probability.
 * Clamps input to prevent -Infinity, Infinity, or NaN.
 * @param {number} p - Probability between 0 and 1
 * @returns {number} Log-odds
 */
function logit(p) {
  const EPS = 1e-15; // Standard precision guard
  const clamped = Math.max(EPS, Math.min(1 - EPS, p));
  return Math.log(clamped / (1 - clamped));
}

/**
 * Maps any real-valued number to a probability between 0 and 1.
 * @param {number} x 
 * @returns {number} Probability
 */
function sigmoid(x) {
  // Guard against extreme values that cause floating point overflow
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

// ---------- Utilities ----------

/**
 * Calculates Poisson probability.
 * Optimized with integer clamping for 'k'.
 */
function poisson(lambda, k) {
  if (lambda <= 0 || k < 0) return 0;
  
  k = Math.floor(k); // Guard: Ensure goals are discrete whole numbers
  if (k === 0) return Math.exp(-lambda);
  
  let prob = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    prob *= lambda / i;
  }
  return prob;
}

const copyToClipboard = async (string) => {
  try {
    await navigator.clipboard.writeText(string);
    console.log('✅ Copied to clipboard!');
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
};

/**
 * Exponentially weighted moving average (EWMA).
 * Optimized to remove Math.pow() by calculating the decay running backwards.
 * Assumes the end of the array is the most recent match.
 */
function weightedAverage(arr) {
  if (!arr || arr.length === 0) return 0;
  
  let sum = 0;
  let totalWeight = 0;
  let currentWeight = 1; // Most recent match gets weight of 1
  
  // Loop backwards: arr[arr.length - 1] is the newest match
  for (let i = arr.length - 1; i >= 0; i--) {
    sum += arr[i] * currentWeight;
    totalWeight += currentWeight;
    
    // Decay the weight for the next older match
    currentWeight *= MODEL_CONFIG.formDecay;
  }
  
  return totalWeight > 0 ? sum / totalWeight : 0;
}


const teams = new Set()
/**
 * Fetches team data and context.
 * Optimized to remove hardcoded limits and return a structured object.
 */
const getTeamData = (team) => {
  // Ensure these global variables exist, or pass them in as parameters
  const leagues = [EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA];
  
  for (const league of leagues) {
    if (league && league[team]) {
      LEAGUE = league.leagueName;
      return {
        data: league[team],
        leagueAvgXG: league.leagueAverageXG,
        leagueName: league.leagueName
      };
    }
  }
  
//  console.warn(`Team '${team}' not found in any league data`);
  teams.add(team);
  return null;
};

/**
 * Calibrates baseline 1X2 odds based on game state dynamics.
 * Operates safely in logit space.
 */
function calibrate1X2(homeWin, draw, awayWin, homeXG, awayXG) {
  const totalXG = homeXG + awayXG;
  const diffXG = homeXG - awayXG;
  
  // --- Convert to logits ---
  let h = logit(homeWin);
  let d = logit(draw);
  let a = logit(awayWin);
  
  // --- Adjustments (Referencing Config for easy tuning) ---
  
  // 1. Reduce overconfidence in high xG games
  if (totalXG > CALIB_CONFIG.highXGThreshold) {
    h *= CALIB_CONFIG.highXGDecay;
    a *= CALIB_CONFIG.highXGDecay;
  }
  
  // 2. Boost draws in balanced games
  if (Math.abs(diffXG) < CALIB_CONFIG.tightXGDiff) {
    d += CALIB_CONFIG.tightXGDrawBoost;
  }
  
  // 3. Reduce draws in very open games
  if (totalXG > CALIB_CONFIG.openGameThreshold) {
    d -= CALIB_CONFIG.openGameDrawPenalty;
  }
  
  // 4. Bias toward stronger side (stability)
  if (diffXG > CALIB_CONFIG.strongDominationDiff) {
    h += CALIB_CONFIG.homeDominationBoost;
  } else if (diffXG < -CALIB_CONFIG.strongDominationDiff) { // Use else if for mutually exclusive states
    a += CALIB_CONFIG.awayDominationBoost;
  }
  
  // --- Back to odds ---
  const ph = sigmoid(h);
  const pd = sigmoid(d);
  const pa = sigmoid(a);
  
  // --- Normalize ---
  const sum = ph + pd + pa;
  
  return {
    homeWin: ph / sum,
    draw: pd / sum,
    awayWin: pa / sum
  };
}



/**
 * Calculates the Expected Goals (xG) for a specific team in a matchup.
 * @param {string} subjectName - The team we are predicting goals for.
 * @param {string} opponentName - The team they are playing against.
 * @param {boolean} isSubjectHome - Whether the subject team is playing at home.
 * @param {boolean} isNeutral - Whether the match is at a neutral venue.
 */
function calculateExpectedGoals(subjectName, opponentName, isSubjectHome, isNeutral = false) {
  // 1. DATA ACQUISITION & NULL SAFETY
  // Updated to match the Object return structure of the optimized getTeamData()
  const subjectInfo = getTeamData(subjectName);
  const opponentInfo = getTeamData(opponentName);
  
  if (!subjectInfo || !opponentInfo) return null;
  
  const { data: subject, leagueAvgXG: subjectLeagueAvg, leagueName: subjectLeague } = subjectInfo;
  const { data: opponent, leagueAvgXG: oppLeagueAvg, leagueName: oppLeague } = opponentInfo;
  
  // 2. SAFEGUARD LEAGUE AVERAGE
  let rawAvg = (subjectLeagueAvg + oppLeagueAvg) / 2;
  let teamLeagueAvg = rawAvg > 2.0 ? rawAvg / 2 : rawAvg;
  teamLeagueAvg = Math.max(0.1, teamLeagueAvg);
  
  // 3. CONTEXTUAL BASE STATS
  const seasonAttack = isNeutral ?
    (subject.homeXG + subject.awayXG) / 2 :
    isSubjectHome ? subject.homeXG : subject.awayXG;
  
  const seasonDefense = isNeutral ?
    (opponent.homeXGA + opponent.awayXGA) / 2 :
    isSubjectHome ? opponent.awayXGA : opponent.homeXGA;
  
  // 4. RECENT FORM (Weighted)
  const recentAttack = weightedAverage(subject.last6XG);
  const recentDefense = weightedAverage(opponent.last6XGA);
  
  // 5. BLEND SEASON + FORM
  const blendedAttack = (seasonAttack * MODEL_CONFIG.seasonWeight) + (recentAttack * MODEL_CONFIG.formWeight);
  const blendedDefense = Math.max(0.1, (seasonDefense * MODEL_CONFIG.seasonWeight) + (recentDefense * MODEL_CONFIG.formWeight));
  
  // 6. CORE INTERACTION: RELATIVE STRENGTH
  let baseXG = (blendedAttack * blendedDefense) / teamLeagueAvg;
  
  // 7. STRENGTH DIFFERENCE MODIFIER
  const strengthDiff = blendedAttack - blendedDefense;
  const cappedDiff = Math.max(-1, Math.min(1, strengthDiff));
  baseXG *= (1 + MODEL_CONFIG.strengthDiffMultiplier * cappedDiff);
  
  // 8. TEMPO ADJUSTMENT
  const subjectTotalEvents = (subject.homeXG + subject.homeXGA + subject.awayXG + subject.awayXGA) / 2;
  const opponentTotalEvents = (opponent.homeXG + opponent.homeXGA + opponent.awayXG + opponent.awayXGA) / 2;
  const matchTempo = (subjectTotalEvents + opponentTotalEvents) / 2;
  
  if (matchTempo < MODEL_CONFIG.lowTempoThreshold) baseXG *= MODEL_CONFIG.lowTempoMultiplier;
  if (matchTempo > MODEL_CONFIG.highTempoThreshold) baseXG *= MODEL_CONFIG.highTempoMultiplier;
  
  // 9. LEAGUE NORMALISATION (Regression toward the mean)
  baseXG = (baseXG * (1 - MODEL_CONFIG.leagueNormWeight)) + (teamLeagueAvg * MODEL_CONFIG.leagueNormWeight);
  
  // 10. ASYMMETRY (Travel Sickness)
  if (isSubjectHome && !isNeutral) {
    const travelSickness = opponent.awayXGA - opponent.homeXGA;
    if (travelSickness > 0.3) {
      baseXG *= MODEL_CONFIG.asymmetryBoost;
    }
  }
  
  // 11. CROSS-LEAGUE ADJUSTMENT (Safeguarded against NaN)
  if (subjectLeague !== oppLeague) {
    const subjStrength = leagueStrength[subjectLeague] || 1.0;
    const oppStrength = leagueStrength[oppLeague] || 1.0;
    baseXG *= (subjStrength / oppStrength);
  }
  
  // 12. FINAL CLAMP
  return Math.max(MODEL_CONFIG.xGMin, Math.min(MODEL_CONFIG.xGMax, baseXG));
}



const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

function calculateLambda3(homeXG, awayXG) {
  const total = homeXG + awayXG;
  const lambda = MODEL_CONFIG.lambda3Base + MODEL_CONFIG.lambda3Slope * (total - 2);
  
  return clamp(lambda, MODEL_CONFIG.lambda3Min, MODEL_CONFIG.lambda3Max);
}



function toOdds(int) {
  return (1 / int).toFixed(2);
}

/**
 * Predicts a football match using a highly optimized deterministic grid.
 * Completely eliminates Monte Carlo redundancy.
 */
function predictMatch(home, away, lg, isNeutral = false) {
  // Assuming calculateExpectedGoals is your 'big boss' function
  const homeXG = calculateExpectedGoals(home, away, true, lg, isNeutral);
  const awayXG = calculateExpectedGoals(away, home, false, lg, isNeutral);
  
  if (!homeXG || !awayXG) return null;
  
  const lambda3 = calculateLambda3(homeXG, awayXG);
  
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
  
  // OPTIMIZATION 1: Pre-calculate Poisson distributions (massive speedup)
  const homePoissonCache = new Float64Array(MAX_GOALS + 1);
  const awayPoissonCache = new Float64Array(MAX_GOALS + 1);
  const l3PoissonCache = new Float64Array(MAX_GOALS + 1);
  
  for (let i = 0; i <= MAX_GOALS; i++) {
    homePoissonCache[i] = poisson(homeXG, i);
    awayPoissonCache[i] = poisson(awayXG, i);
    l3PoissonCache[i] = poisson(lambda3, i);
  }
  
  // Deterministic Grid Execution
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      let prob = 0;
      const maxK = Math.min(h, a);
      
      // Fast inner loop using the pre-calculated cache
      for (let k = 0; k <= maxK; k++) {
        prob += homePoissonCache[h - k] *
          awayPoissonCache[a - k] *
          l3PoissonCache[k];
      }
      
      totalMass += prob;
      
      // Market Accumulations
      if (h + a <= 1) under15 += prob;
      if (h + a <= 2) under25 += prob;
      if (h + a <= 3) under35 += prob;
      
      if (h >= 1 && a >= 1) btts += prob;
      
      if (h > a) _homeWin += prob;
      else if (h === a) _draw += prob;
      else _awayWin += prob;
      
      // OPTIMIZATION 3: Store scorelines directly from exact grid math
      scorelinesList.push({ score: `${h}-${a}`, prob });
    }
  }
  
  // OPTIMIZATION 4: Normalize truncation error BEFORE running calibration
  if (totalMass > 0) {
    _homeWin /= totalMass;
    _draw /= totalMass;
    _awayWin /= totalMass;
    under15 /= totalMass;
    under25 /= totalMass;
    under35 /= totalMass;
    
    btts /= totalMass;
    
    // Normalize individual scorelines
    for (let i = 0; i < scorelinesList.length; i++) {
      scorelinesList[i].prob /= totalMass;
    }
  }
  
  // Calibrate safely with pre-normalized baseline numbers
  let { homeWin, draw, awayWin } = calibrate1X2(_homeWin, _draw, _awayWin, homeXG, awayXG);
  
  // Context-specific heuristic adjustments for BTTS
  const totalXG = homeXG + awayXG;
  const imbalance = Math.abs(homeXG - awayXG);
  
  if (totalXG < MODEL_CONFIG.bttsLowTempoThreshold) btts *= MODEL_CONFIG.bttsLowTempoPenalty;
  if (imbalance > MODEL_CONFIG.bttsImbalanceThreshold) btts *= MODEL_CONFIG.bttsImbalancePenalty;
  
  // Extract top 3 correct scorelines cleanly from the exact array
  const topScorelines = scorelinesList
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3)
    .map(item => ({
      score: item.score,
      probability: toOdds(item.prob)
    }));
  
  if (!lg) {
    lg = LEAGUE;
  }
  
  return {
    match: { homeTeam: home, awayTeam: away },
    league: lg,
    xG: {
      home: homeXG.toFixed(2),
      away: awayXG.toFixed(2),
      total: totalXG.toFixed(2)
    },
    correlation: lambda3.toFixed(3),
    odds: {
      over15: toOdds(1 - under15),
      under15: toOdds(under15),
      over25: toOdds(1 - under25),
      under25: toOdds(under25),
      over35: toOdds(1 - under35),
      under35: toOdds(under35),
      gg: toOdds(btts),
      ng: toOdds(1 - btts),
      homeWin: toOdds(homeWin),
      draw: toOdds(draw),
      awayWin: toOdds(awayWin)
    },
    topScorelines
  };
}

// Knuth's algorithm
function samplePoisson(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function getTopScorelines(homeLambda, awayLambda, lambda3) {
  // Use a global or passed constant; assuming 10000 for this example
  const SIMS = SIMULATIONS;
  
  const MAX_GOALS = MODEL_CONFIG.maxGoalsPerTeamMC; // e.g., 8
  const GRID_SIZE = MAX_GOALS + 1; // 0 through 8 is 9 possible goals
  const sharedImpact = MODEL_CONFIG.sharedImpact;
  
  // High-performance typed array for counting scorelines
  const scoreGrid = new Int32Array(GRID_SIZE * GRID_SIZE);
  
  // Pre-calculate the independent base lambdas
  const homeBaseLambda = Math.max(0, homeLambda - lambda3);
  const awayBaseLambda = Math.max(0, awayLambda - lambda3);
  
  // Hot Loop: Keep this as lean as mathematically possible
  for (let i = 0; i < SIMS; i++) {
    const shared = samplePoisson(lambda3);
    const sharedAdj = Math.round(shared * sharedImpact);
    
    const homeExtra = samplePoisson(homeBaseLambda);
    const awayExtra = samplePoisson(awayBaseLambda);
    
    // Clamp to MAX_GOALS
    const h = homeExtra + sharedAdj > MAX_GOALS ? MAX_GOALS : homeExtra + sharedAdj;
    const a = awayExtra + sharedAdj > MAX_GOALS ? MAX_GOALS : awayExtra + sharedAdj;
    
    // Update flat array count (e.g., 2-1 becomes index (2 * 9) + 1 = 19)
    scoreGrid[h * GRID_SIZE + a]++;
  }
  
  // Extract and format the results
  const results = [];
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const count = scoreGrid[h * GRID_SIZE + a];
      if (count > 0) {
        results.push({ score: `${h}-${a}`, count });
      }
    }
  }
  
  // Sort by raw integer count FIRST, slice top 3, THEN format to string
  const topScorelines = results
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(item => ({
      score: item.score,
      probability: ((item.count / SIMS) * 100).toFixed(2)
    }));
  
  return {
    topScorelines
  };
}


async function predictMultiMatch(fixtures) {
  const outArr = [];
  let output = "";
  
  fixtures.forEach(({ homeTeam, awayTeam, league, isNeutral }, i) => {
    const { country, startDate, markets } = fixtures[i];
    
    const splittedDate = startDate.split(" ");
    
    const { OverUnder, BTTS } = markets;
    
    const oneX2 = markets["1X2"];
    
    const OU15 = OverUnder["OU1.5"];
    const OU25 = OverUnder["OU2.5"];
    const OU35 = OverUnder["OU3.5"];
    
    const fullDate = new Date(splittedDate[0]).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) + "  (" + splittedDate[1].slice(0, 5)+")";
    
    let prediction = predictMatch(homeTeam, awayTeam, league, isNeutral);
    
    
    if (prediction) {
      const withOdds = {
        ...prediction,
        fullDate,
        oneX2,
        OU15,
        OU25,
        OU35,
        BTTS
      }
      
      const edge = computeROI(withOdds);
      
      prediction = {
        ...withOdds,
        ...edge
      }
      
      outArr.push(prediction);
      
      output += "\n\n" + JSON.stringify(prediction, null, 2);
    }
  });
  
  console.log(JSON.stringify([...teams]), "\n")
  //console.log(output);
  return outArr;
};


function computeROI(data) {
  const { odds, oneX2, OU15, OU25, OU35, BTTS } = data;
  
  // Define each market group and their output key mappings
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
    
    // Compute ROI edge for each outcome: (market odds / predicted odds) - 1
    for (const m of group.mappings) {
      const predVal = parseFloat(odds[m.predKey]);
      const marketVal = parseFloat(group.source[m.marketKey]);
      
      if (predVal > 0 && marketVal > 0) {
        // ROI edge = (market decimal odds / predicted decimal odds) - 1
        const edge = (marketVal / predVal) - 1;
        result[m.outKey] = {
          edge: parseFloat(edge.toFixed(2))
        };
      } else {
        result[m.outKey] = null;
      }
    }
  }
  
  // Assign high/low classes based on pairwise comparisons (unchanged)
  const marketKeyMappings = {
    'over15': 'under15',
    'over25': 'under25',
    'over35': 'under35',
    'bttsYes': 'bttsNo'
  };
  
  const keys = Object.keys(marketKeyMappings);
  for (let key of keys) {
    const pred = marketKeyMappings[key];
    const a = result[key]?.edge;
    const b = result[pred]?.edge;
    if (a !== undefined && b !== undefined) {
      if (a > b) {
        result[key].hClass = "high";
        result[pred].hClass = "low";
      } else if (b > a) {
        result[key].hClass = "low";
        result[pred].hClass = "high";
      } else {
        result[key].hClass = "high";
        result[pred].hClass = "high";
      }
    }
  }
  
  // Home/away comparison
  if (result.homeWin && result.awayWin) {
    const homeEdge = result.homeWin.edge;
    const awayEdge = result.awayWin.edge;
    if (homeEdge > awayEdge) {
      result.homeWin.hClass = "high";
      result.awayWin.hClass = "low";
    } else {
      result.awayWin.hClass = "high";
      result.homeWin.hClass = "low";
    }
  }
  
  return result;
}


const fetchFixtures = async () => {
  const res = await fetch("https://www.fotmob.com/api/data/matches?date=20260705&timezone=Africa%2FLagos&ccode3=NGA&includeNextDayLateNight=true")
  const json = await res.json()
  const leagues = json.leagues;
  /* 
  	For each
  	.name
  	.ccode
  	
  	.matches (each):
  	.time
  	.status.started
  	.status.finished
  	
  	.home: (.name, .score, .longName)
  	
  	*/
  console.log(leagues[0])
}



export default predictMultiMatch;