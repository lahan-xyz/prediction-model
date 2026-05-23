import { EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA } from './league_stats.js';
// ============================================
// Football Prediction Model
// ============================================

const SIMULATIONS = 150000;

let LEAGUE = "";

/** 
 // Would uncomment once i feel like 
 const LEAGUE_DECAY = {
  "EPL": 0.80,
  "BUNDESLIGA": 0.75,
  "LALIGA": 0.85,
  "LIGUE1": 0.82,
  "SERIEA": 0.88
};
 */

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

const leagueStrength = {
  "EPL": 1.000,
  "La Liga": 0.929,
  "Bundesliga": 0.921,
  "Serie A": 0.911,
  "Ligue 1": 0.909
};


function logit(p) {
  return Math.log(p / (1 - p));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// ---------- Utilities ----------
function poisson(lambda, k) {
  if (lambda <= 0 || k < 0) return 0;
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

// Exponential weighted average 
function weightedAverage(arr) {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  let totalWeight = 0;
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    const weight = Math.pow(MODEL_CONFIG.formDecay, n - 1 - i);
    sum += arr[i] * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? sum / totalWeight : 0;
}

const getTeamData = (team) => {
  const leagues = [EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA];
  for (let i = 0; i < 5; i++) {
    const teamData = leagues[i][team];
    if (teamData) {
      return [teamData, leagues[i].leagueAverageXG, leagues[i].leagueName];
    }
  }
  console.warn(`Team '${team}' not found in any league data`);
  return [];
};

function calibrate1X2(homeWin, draw, awayWin, homeXG, awayXG) {
  const totalXG = homeXG + awayXG;
  const diffXG = homeXG - awayXG;
  
  // --- Convert to logits ---
  let h = logit(homeWin);
  let d = logit(draw);
  let a = logit(awayWin);
  
  // --- Adjustments ---
  
  // 1. Reduce overconfidence in high xG games
  if (totalXG > 3.2) {
    h *= 0.92;
    a *= 0.92;
  }
  
  // 2. Boost draws in balanced games
  if (Math.abs(diffXG) < 0.4) {
    d += 0.25;
  }
  
  // 3. Reduce draws in very open games
  if (totalXG > 3.6) {
    d -= 0.2;
  }
  
  // 4. Slight bias toward stronger side (stability)
  if (diffXG > 0.5) h += 0.3;
  if (diffXG < -0.5) a += 0.2;
  
  // --- Back to probabilities ---
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
 * * @param {string} subjectName - The team we are predicting goals for.
 * @param {string} opponentName - The team they are playing against.
 * @param {boolean} isSubjectHome - Whether the subject team is playing at home.
 */
function calculateExpectedGoals(subjectName, opponentName, isSubjectHome, league, isNeutral) {
  // 1. DATA ACQUISITION
  const [subject, subjectLeagueAvg, subjectLeague] = getTeamData(subjectName);
  const [opponent, oppLeagueAvg, oppLeague] = getTeamData(opponentName);
  
  if (league) {
    LEAGUE = league;
  } else {
    if (isSubjectHome)
      LEAGUE = subjectLeague;
  }
  // 2. SAFEGUARD LEAGUE AVERAGE
  // Ensures we use the single-team average (~1.3 - 1.6) rather than total match goals (~2.6 - 3.2).
  let rawAvg = (subjectLeagueAvg + oppLeagueAvg) / 2;
  let teamLeagueAvg = rawAvg > 2.0 ? rawAvg / 2 : rawAvg;
  teamLeagueAvg = Math.max(0.1, teamLeagueAvg);
  
  // 3. CONTEXTUAL BASE STATS
  // Selects stats based on Home/Away status to capture inherent home advantage.
  const seasonAttack = isNeutral ? (subject.homeXG + subject.awayXG) / 2 : isSubjectHome ? subject.homeXG : subject.awayXG;
  const seasonDefense = isNeutral ? (opponent.homeXGA + opponent.awayXGA) / 2 : isSubjectHome ? opponent.awayXGA : opponent.homeXGA;
  
  // 4. RECENT FORM (Weighted)
  const recentAttack = weightedAverage(subject.last6XG);
  const recentDefense = weightedAverage(opponent.last6XGA);
  
  // 5. BLEND SEASON + FORM
  const blendedAttack = (seasonAttack * MODEL_CONFIG.seasonWeight) + (recentAttack * MODEL_CONFIG.formWeight);
  const blendedDefense = Math.max(0.1, (seasonDefense * MODEL_CONFIG.seasonWeight) + (recentDefense * MODEL_CONFIG.formWeight));
  
  // 6. CORE INTERACTION: RELATIVE STRENGTH
  // (Team Attack / League Avg) * (Opponent Defense / League Avg) * League Avg
  // Simplified to: (Attack * Defense) / LeagueAvg
  let baseXG = (blendedAttack * blendedDefense) / teamLeagueAvg;
  
  // 7. STRENGTH DIFFERENCE MODIFIER
  // Provides a slight boost to the superior side to account for "game control."
  const strengthDiff = blendedAttack - blendedDefense;
  const cappedDiff = Math.max(-1, Math.min(1, strengthDiff));
  baseXG *= (1 + MODEL_CONFIG.strengthDiffMultiplier * cappedDiff);
  
  // 8. TEMPO ADJUSTMENT
  // Measures "Event Volume" (Total XG + XGA for both sides). 
  // High event teams create chaotic, high-scoring environments.
  const subjectTotalEvents = (subject.homeXG + subject.homeXGA + subject.awayXG + subject.awayXGA) / 2;
  const opponentTotalEvents = (opponent.homeXG + opponent.homeXGA + opponent.awayXG + opponent.awayXGA) / 2;
  const matchTempo = (subjectTotalEvents + opponentTotalEvents) / 2;
  
  if (matchTempo < MODEL_CONFIG.lowTempoThreshold) baseXG *= MODEL_CONFIG.lowTempoMultiplier;
  if (matchTempo > MODEL_CONFIG.highTempoThreshold) baseXG *= MODEL_CONFIG.highTempoMultiplier;
  
  // 9. LEAGUE NORMALISATION (Regression toward the mean)
  baseXG = (baseXG * (1 - MODEL_CONFIG.leagueNormWeight)) + (teamLeagueAvg * MODEL_CONFIG.leagueNormWeight);
  
  // 10. ASYMMETRY (Travel Sickness)
  // Specific penalty for teams that statistically collapse when playing away.
  if (isSubjectHome) {
    const travelSickness = opponent.awayXGA - opponent.homeXGA;
    if (travelSickness > 0.3) {
      baseXG *= MODEL_CONFIG.asymmetryBoost;
    }
  }
  
  if (subjectLeague !== oppLeague) {
    baseXG *= leagueStrength[subjectLeague]/leagueStrength[oppLeague];
  }

  
  // 11. FINAL CLAMP
  return Math.max(MODEL_CONFIG.xGMin, Math.min(MODEL_CONFIG.xGMax, baseXG));
}



function calculateLambda3(homeXG, awayXG) {
  const total = homeXG + awayXG;
  let lambda = MODEL_CONFIG.lambda3Base + MODEL_CONFIG.lambda3Slope * (total - 2);
  return Math.max(MODEL_CONFIG.lambda3Min, Math.min(MODEL_CONFIG.lambda3Max, lambda));
}

// Predict match
function predictMatch(home, away, lg, isNeutral = false) {
  const homeXG = calculateExpectedGoals(home, away, true, lg, isNeutral);
  const awayXG = calculateExpectedGoals(away, home, false, lg, isNeutral);
  const lambda3 = calculateLambda3(homeXG, awayXG);
  
  let under25 = 0;
  let btts = 0;
  let _homeWin = 0;
  let _draw = 0;
  let _awayWin = 0;
  let totalMass = 0;
  
  const MAX_GOALS = MODEL_CONFIG.maxGoalsDeterministic;
  
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      let prob = 0;
      const maxK = Math.min(h, a);
      for (let k = 0; k <= maxK; k++) {
        prob += poisson(homeXG, h - k) *
          poisson(awayXG, a - k) *
          poisson(lambda3, k);
      }
      
      totalMass += prob;
      
      if (h + a <= 2) under25 += prob;
      if (h >= 1 && a >= 1) btts += prob;
      
      // 1X2
      if (h > a) _homeWin += prob;
      else if (h === a) _draw += prob;
      else _awayWin += prob;
    }
  }
  
  let { homeWin, draw, awayWin } = calibrate1X2(_homeWin, _draw, _awayWin, homeXG, awayXG);
  
  // Optional normalization (tiny truncation error)
  if (totalMass > 0 && totalMass < 0.999) {
    under25 /= totalMass;
    btts /= totalMass;
    homeWin /= totalMass;
    draw /= totalMass;
    awayWin /= totalMass;
  }
  
  const totalXG = homeXG + awayXG;
  const imbalance = Math.abs(homeXG - awayXG);
  
  // Low tempo → fewer goals
  if (totalXG < MODEL_CONFIG.bttsLowTempoThreshold) btts *= MODEL_CONFIG.bttsLowTempoPenalty;
  
  // One-sided games → less BTTS
  if (imbalance > MODEL_CONFIG.bttsImbalanceThreshold) btts *= MODEL_CONFIG.bttsImbalancePenalty;
  
  const others = getTopScorelines(homeXG, awayXG, lambda3);
  
  return {
    match: {
      homeTeam: home,
      awayTeam: away
    },
    league: LEAGUE,
    xG: {
      home: homeXG.toFixed(2),
      away: awayXG.toFixed(2),
      total: (homeXG + awayXG).toFixed(2)
    },
    correlation: lambda3.toFixed(3),
    probabilities: {
      over25: ((1 - under25) * 100).toFixed(2),
      under25: ((under25) * 100).toFixed(2),
      gg: (btts * 100).toFixed(2),
      ng: ((1 - btts) * 100).toFixed(2),
      // 1X2
      homeWin: (homeWin * 100).toFixed(2),
      draw: (draw * 100).toFixed(2),
      awayWin: (awayWin * 100).toFixed(2)
    },
    topScorelines: others.topScorelines,
    oddProb: others.oddTotalProb,
    evenProb: others.evenTotalProb
  };
}

// Monte Carlo Simulation
function getTopScorelines(homeLambda, awayLambda, lambda3) {
  const scoreCounts = new Map();
  const MAX_GOALS_PER_TEAM = MODEL_CONFIG.maxGoalsPerTeamMC;
  const sharedImpact = MODEL_CONFIG.sharedImpact;
  
  let oddCount = 0,
    evenCount = 0,
    total = 0;
  
  for (let i = 0; i < SIMULATIONS; i++) {
    const shared = samplePoisson(lambda3);
    const homeExtra = samplePoisson(Math.max(0, homeLambda - lambda3));
    const awayExtra = samplePoisson(Math.max(0, awayLambda - lambda3));
    
    const h = Math.min(
      homeExtra + Math.round(shared * sharedImpact),
      MAX_GOALS_PER_TEAM
    );
    const a = Math.min(
      awayExtra + Math.round(shared * sharedImpact),
      MAX_GOALS_PER_TEAM
    );
    
    total = h + a;
    if (total % 2 === 0) evenCount++;
    else oddCount++;
    
    const key = `${h}-${a}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);
  }
  
  const outArr = Array.from(scoreCounts.entries())
    .map(([score, count]) => ({
      score,
      probability: ((count / SIMULATIONS) * 100).toFixed(2)
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
  
  return {
    topScorelines: outArr,
    oddTotalProb: (oddCount / SIMULATIONS * 100).toFixed(2),
    evenTotalProb: (evenCount / SIMULATIONS * 100).toFixed(2)
  }
}

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

const predictMultiMatch = (fixtures) => {
  const outArr = [];
  let output = "";
  fixtures.forEach(([home, away, league, isNeutral]) => {
    const prediction = predictMatch(home, away, league, isNeutral);
    outArr.push(prediction);
    output += "\n\n" + JSON.stringify(prediction, null, 2);
  });
  
  console.log(output);
  // copyToClipboard(output);
  return outArr;
};


export default predictMultiMatch;