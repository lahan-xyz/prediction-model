import { EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA } from './league_stats.js';

// ============================================
// Football Prediction Model
// ============================================

let LEAGUE = "";
const missingTeams = new Set(); // Renamed for clarity to avoid global state pollution

const MODEL_CONFIG = {
  formDecay: 0.85,
  seasonWeight: 0.7,
  formWeight: 0.3,
  strengthDiffMultiplier: 0.08,
  defenseSuppressionFactor: 0.12,
  defenseSuppressionCap: 0.5,
  lowTempoThreshold: 2.6,
  lowTempoMultiplier: 0.92,
  highTempoThreshold: 3.4,
  highTempoMultiplier: 1.05,
  leagueNormWeight: 0.1,
  asymmetryBoost: 1.05,
  lambda3Base: 0.04,
  lambda3Slope: 0.03,
  lambda3Min: 0.03,
  lambda3Max: 0.18,
  bttsLowTempoPenalty: 0.92,
  bttsImbalancePenalty: 0.9,
  bttsImbalanceThreshold: 0.8,
  bttsLowTempoThreshold: 3.0,
  maxGoalsDeterministic: 10,
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
  awayDominationBoost: 0.2 
};

const leagueStrength = {
  "EPL": 1.000,
  "La Liga": 0.929,
  "Bundesliga": 0.921,
  "Serie A": 0.911,
  "Ligue 1": 0.909
};

// ---------- Utilities ----------

function logit(p) {
  const EPS = 1e-15;
  const clamped = Math.max(EPS, Math.min(1 - EPS, p));
  return Math.log(clamped / (1 - clamped));
}

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

function weightedAverage(arr) {
  if (!arr || arr.length === 0) return 0;
  
  let sum = 0;
  let totalWeight = 0;
  let currentWeight = 1; 
  
  for (let i = arr.length - 1; i >= 0; i--) {
    sum += arr[i] * currentWeight;
    totalWeight += currentWeight;
    currentWeight *= MODEL_CONFIG.formDecay;
  }
  
  return totalWeight > 0 ? sum / totalWeight : 0;
}

const getTeamData = (team) => {
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
  
  missingTeams.add(team); // Safely log missing teams for debugging
  return null;
};

/**
 * FIXED: Replaced independent sigmoids with Softmax for valid multi-class probability.
 */
function calibrate1X2(homeWin, draw, awayWin, homeXG, awayXG) {
  const totalXG = homeXG + awayXG;
  const diffXG = homeXG - awayXG;
  
  let h = logit(homeWin);
  let d = logit(draw);
  let a = logit(awayWin);
  
  if (totalXG > CALIB_CONFIG.highXGThreshold) {
    h *= CALIB_CONFIG.highXGDecay;
    a *= CALIB_CONFIG.highXGDecay;
  }
  if (Math.abs(diffXG) < CALIB_CONFIG.tightXGDiff) {
    d += CALIB_CONFIG.tightXGDrawBoost;
  }
  if (totalXG > CALIB_CONFIG.openGameThreshold) {
    d -= CALIB_CONFIG.openGameDrawPenalty;
  }
  if (diffXG > CALIB_CONFIG.strongDominationDiff) {
    h += CALIB_CONFIG.homeDominationBoost;
  } else if (diffXG < -CALIB_CONFIG.strongDominationDiff) { 
    a += CALIB_CONFIG.awayDominationBoost;
  }
  
  // Apply Softmax
  const expH = Math.exp(h);
  const expD = Math.exp(d);
  const expA = Math.exp(a);
  const sum = expH + expD + expA;
  
  return {
    homeWin: expH / sum,
    draw: expD / sum,
    awayWin: expA / sum
  };
}

function calculateExpectedGoals(subjectName, opponentName, isSubjectHome, isNeutral = false) {
  const subjectInfo = getTeamData(subjectName);
  const opponentInfo = getTeamData(opponentName);
  
  if (!subjectInfo || !opponentInfo) return null;
  
  const { data: subject, leagueAvgXG: subjectLeagueAvg, leagueName: subjectLeague } = subjectInfo;
  const { data: opponent, leagueAvgXG: oppLeagueAvg, leagueName: oppLeague } = opponentInfo;
  
  let rawAvg = (subjectLeagueAvg + oppLeagueAvg) / 2;
  let teamLeagueAvg = rawAvg > 2.0 ? rawAvg / 2 : rawAvg;
  teamLeagueAvg = Math.max(0.1, teamLeagueAvg);
  
  const seasonAttack = isNeutral ? (subject.homeXG + subject.awayXG) / 2 : (isSubjectHome ? subject.homeXG : subject.awayXG);
  const seasonDefense = isNeutral ? (opponent.homeXGA + opponent.awayXGA) / 2 : (isSubjectHome ? opponent.awayXGA : opponent.homeXGA);
  
  const recentAttack = weightedAverage(subject.last6XG);
  const recentDefense = weightedAverage(opponent.last6XGA);
  
  const blendedAttack = (seasonAttack * MODEL_CONFIG.seasonWeight) + (recentAttack * MODEL_CONFIG.formWeight);
  const blendedDefense = Math.max(0.1, (seasonDefense * MODEL_CONFIG.seasonWeight) + (recentDefense * MODEL_CONFIG.formWeight));
  
  let baseXG = (blendedAttack * blendedDefense) / teamLeagueAvg;
  
  const strengthDiff = blendedAttack - blendedDefense;
  const cappedDiff = Math.max(-1, Math.min(1, strengthDiff));
  baseXG *= (1 + MODEL_CONFIG.strengthDiffMultiplier * cappedDiff);
  
  const subjectTotalEvents = (subject.homeXG + subject.homeXGA + subject.awayXG + subject.awayXGA) / 2;
  const opponentTotalEvents = (opponent.homeXG + opponent.homeXGA + opponent.awayXG + opponent.awayXGA) / 2;
  const matchTempo = (subjectTotalEvents + opponentTotalEvents) / 2;
  
  if (matchTempo < MODEL_CONFIG.lowTempoThreshold) baseXG *= MODEL_CONFIG.lowTempoMultiplier;
  if (matchTempo > MODEL_CONFIG.highTempoThreshold) baseXG *= MODEL_CONFIG.highTempoMultiplier;
  
  baseXG = (baseXG * (1 - MODEL_CONFIG.leagueNormWeight)) + (teamLeagueAvg * MODEL_CONFIG.leagueNormWeight);
  
  if (isSubjectHome && !isNeutral) {
    const travelSickness = opponent.awayXGA - opponent.homeXGA;
    if (travelSickness > 0.3) {
      baseXG *= MODEL_CONFIG.asymmetryBoost;
    }
  }
  
  if (subjectLeague !== oppLeague) {
    const subjStrength = leagueStrength[subjectLeague] || 1.0;
    const oppStrength = leagueStrength[oppLeague] || 1.0;
    baseXG *= (subjStrength / oppStrength);
  }
  
  return Math.max(MODEL_CONFIG.xGMin, Math.min(MODEL_CONFIG.xGMax, baseXG));
}

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

function calculateLambda3(homeXG, awayXG) {
  const total = homeXG + awayXG;
  const lambda = MODEL_CONFIG.lambda3Base + MODEL_CONFIG.lambda3Slope * (total - 2);
  return clamp(lambda, MODEL_CONFIG.lambda3Min, MODEL_CONFIG.lambda3Max);
}

function toOdds(probability) {
  if (probability <= 0) return "0.00";
  return (1 / probability).toFixed(2);
}

function predictMatch(home, away, lg, isNeutral = false) {
  const homeXG = calculateExpectedGoals(home, away, true, isNeutral);
  const awayXG = calculateExpectedGoals(away, home, false, isNeutral);
  
  if (!homeXG || !awayXG) return null;
  
  const lambda3 = calculateLambda3(homeXG, awayXG);
  
  // FIXED: Must subtract shared lambda3 to avoid goal inflation!
  const homeBaseXG = Math.max(0, homeXG - lambda3);
  const awayBaseXG = Math.max(0, awayXG - lambda3);
  
  let under15 = 0, under25 = 0, under35 = 0, btts = 0;
  let _homeWin = 0, _draw = 0, _awayWin = 0, totalMass = 0;
  
  const MAX_GOALS = MODEL_CONFIG.maxGoalsDeterministic;
  const scorelinesList = [];
  
  const homePoissonCache = new Float64Array(MAX_GOALS + 1);
  const awayPoissonCache = new Float64Array(MAX_GOALS + 1);
  const l3PoissonCache = new Float64Array(MAX_GOALS + 1);
  
  for (let i = 0; i <= MAX_GOALS; i++) {
    // FIXED: Utilizing the base XG for caching independent goals
    homePoissonCache[i] = poisson(homeBaseXG, i);
    awayPoissonCache[i] = poisson(awayBaseXG, i);
    l3PoissonCache[i] = poisson(lambda3, i);
  }
  
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
  
  if (totalMass > 0) {
    _homeWin /= totalMass;
    _draw /= totalMass;
    _awayWin /= totalMass;
    under15 /= totalMass;
    under25 /= totalMass;
    under35 /= totalMass;
    btts /= totalMass;
    for (let i = 0; i < scorelinesList.length; i++) {
      scorelinesList[i].prob /= totalMass;
    }
  }
  
  let { homeWin, draw, awayWin } = calibrate1X2(_homeWin, _draw, _awayWin, homeXG, awayXG);
  
  const totalXG = homeXG + awayXG;
  const imbalance = Math.abs(homeXG - awayXG);
  
  if (totalXG < MODEL_CONFIG.bttsLowTempoThreshold) btts *= MODEL_CONFIG.bttsLowTempoPenalty;
  if (imbalance > MODEL_CONFIG.bttsImbalanceThreshold) btts *= MODEL_CONFIG.bttsImbalancePenalty;
  
  const topScorelines = scorelinesList
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3)
    .map(item => ({
      score: item.score,
      probability: toOdds(item.prob)
    }));
  
  return {
    match: { homeTeam: home, awayTeam: away },
    league: lg || LEAGUE,
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

async function predictMultiMatch(fixtures) {
  const outArr = [];
  
  fixtures.forEach(({ homeTeam, awayTeam, league, isNeutral, startDate, markets }) => {
    // FIXED: Robust date parsing instead of brittle split operations
    const fullDateObj = new Date(startDate);
    const fullDate = fullDateObj.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) + ` (${fullDateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })})`;
    
    const { OverUnder, BTTS, "1X2": oneX2 } = markets;
    const OU15 = OverUnder["OU1.5"];
    const OU25 = OverUnder["OU2.5"];
    const OU35 = OverUnder["OU3.5"];
    
    let prediction = predictMatch(homeTeam, awayTeam, league, isNeutral);
    
    if (prediction) {
      const withOdds = { ...prediction, fullDate, oneX2, OU15, OU25, OU35, BTTS };
      const edge = computeROI(withOdds);
      outArr.push({ ...withOdds, ...edge });
    }
  });
  
  if(missingTeams.size > 0) console.warn("Missing Teams in Dataset:", [...missingTeams]);
  return outArr;
}

// Note: computeROI remains functionally identical, provided it receives correct object references.

// ---------- Post-Processing Processing ----------

function computeROI(data) {
  const { odds, oneX2, OU15, OU25, OU35, BTTS } = data;
  
  const groups = [
    { source: oneX2, mappings: [{ outKey: 'homeWin', marketKey: 'Home', predKey: 'homeWin' }, { outKey: 'draw', marketKey: 'Draw', predKey: 'draw' }, { outKey: 'awayWin', marketKey: 'Away', predKey: 'awayWin' }] },
    { source: OU15, mappings: [{ outKey: 'over15', marketKey: 'Over', predKey: 'over15' }, { outKey: 'under15', marketKey: 'Under', predKey: 'under15' }] },
    { source: OU25, mappings: [{ outKey: 'over25', marketKey: 'Over', predKey: 'over25' }, { outKey: 'under25', marketKey: 'Under', predKey: 'under25' }] },
    { source: OU35, mappings: [{ outKey: 'over35', marketKey: 'Over', predKey: 'over35' }, { outKey: 'under35', marketKey: 'Under', predKey: 'under35' }] },
    { source: BTTS, mappings: [{ outKey: 'bttsYes', marketKey: 'BTTS', predKey: 'gg' }, { outKey: 'bttsNo', marketKey: 'BTTSN', predKey: 'ng' }] }
  ];
  
  const result = {};
  
  for (const group of groups) {
    if (!group.source) continue;
    
    for (const m of group.mappings) {
      const predVal = parseFloat(odds[m.predKey]);
      const marketVal = parseFloat(group.source[m.marketKey]);
      
      // FIX: Ensure no division by zero causing Infinity limits
      if (predVal > 0.001 && marketVal > 0) {
        const edge = (marketVal / predVal) - 1;
        result[m.outKey] = { edge: parseFloat(edge.toFixed(2)) };
      } else {
        result[m.outKey] = null;
      }
    }
  }
  
  const marketKeyMappings = { 'over15': 'under15', 'over25': 'under25', 'over35': 'under35', 'bttsYes': 'bttsNo' };
  
  for (let key of Object.keys(marketKeyMappings)) {
    const pred = marketKeyMappings[key];
    const a = result[key]?.edge;
    const b = result[pred]?.edge;
    if (a !== undefined && b !== undefined) {
      if (a > b) { result[key].hClass = "high"; result[pred].hClass = "low"; } 
      else if (b > a) { result[key].hClass = "low"; result[pred].hClass = "high"; } 
      else { result[key].hClass = "high"; result[pred].hClass = "high"; }
    }
  }
  
  if (result.homeWin && result.awayWin) {
    if (result.homeWin.edge > result.awayWin.edge) {
      result.homeWin.hClass = "high"; result.awayWin.hClass = "low";
    } else {
      result.awayWin.hClass = "high"; result.homeWin.hClass = "low";
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