import {
  EPL,
  LALIGA,
  LIGUE1,
  BUNDESLIGA,
  SERIEA,
} from "./league_stats.js";

// ============================================
// Football Prediction Model
// ============================================

const MODEL_CONFIG = {
  formDecay: 0.85,
  seasonWeight: 0.7,
  formWeight: 0.3,
  strengthDiffMultiplier: 0.08,
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
  xGMin: 0.1,
  xGMax: 5.5,
  recentFormLimit: 6,
  maxFairOdds: 999.99,
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
  awayDominationBoost: 0.2,
};

const leagueStrength = {
  "EPL": 1.0,
  "La Liga": 0.929,
  "Bundesliga": 0.921,
  "Serie A": 0.911,
  "Ligue 1": 0.909,
};

const LEAGUES = [EPL, LALIGA, LIGUE1, BUNDESLIGA, SERIEA].filter(Boolean);

// ============================================
// Utilities
// ============================================

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = safeNumber(value, min);
  return Math.max(min, Math.min(max, n));
}

function poisson(lambda, k) {
  const l = safeNumber(lambda, 0);
  const goals = Math.floor(safeNumber(k, 0));
  
  if (goals < 0) return 0;
  
  if (l <= 0) {
    return goals === 0 ? 1 : 0;
  }
  
  if (goals === 0) {
    return Math.exp(-l);
  }
  
  let prob = Math.exp(-l);
  
  for (let i = 1; i <= goals; i++) {
    prob *= l / i;
  }
  
  return prob;
}

function weightedAverage(arr, limit = MODEL_CONFIG.recentFormLimit) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  
  const recent =
    Number.isFinite(limit) && limit > 0 ? arr.slice(-limit) : arr.slice();
  
  let sum = 0;
  let totalWeight = 0;
  let currentWeight = 1;
  
  // Assumes the newest match is at the end of the array.
  for (let i = recent.length - 1; i >= 0; i--) {
    const value = safeNumber(recent[i], 0);
    sum += value * currentWeight;
    totalWeight += currentWeight;
    currentWeight *= MODEL_CONFIG.formDecay;
  }
  
  return totalWeight > 0 ? sum / totalWeight : 0;
}


function isTeamStats(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    ("homeXG" in entry ||
      "awayXG" in entry ||
      "homeXGA" in entry ||
      "awayXGA" in entry ||
      "last6XG" in entry)
  );
}

function getTeamData(team) {
  if (!team) return null;
  
  for (const league of LEAGUES) {
    if (!league || typeof league !== "object") continue;
    
    if (
      Object.prototype.hasOwnProperty.call(league, team) &&
      isTeamStats(league[team])
    ) {
      return {
        data: league[team],
        leagueAvgXG: safeNumber(league.leagueAverageXG, 1.2),
        leagueName: league.leagueName || "Unknown",
      };
    }
  }
  
  console.warn("Can't find: '"+team+"'")
  
  return null;
}

// ============================================
// Calibration
// ============================================

function calibrate1X2(homeWin, draw, awayWin, homeXG, awayXG) {
  const fallback = {
    homeWin: 0.3333,
    draw: 0.3334,
    awayWin: 0.3333,
  };
  
  if (![homeWin, draw, awayWin].every(Number.isFinite)) {
    return fallback;
  }
  
  const total = homeWin + draw + awayWin;
  
  if (!Number.isFinite(total) || total <= 0) {
    return fallback;
  }
  
  let h = Math.max(1e-6, homeWin / total);
  let d = Math.max(1e-6, draw / total);
  let a = Math.max(1e-6, awayWin / total);
  
  const totalXG = safeNumber(homeXG, 0) + safeNumber(awayXG, 0);
  const diffXG = safeNumber(homeXG, 0) - safeNumber(awayXG, 0);
  
  // High-total games tend to compress decisive outcomes slightly.
  if (totalXG > CALIB_CONFIG.highXGThreshold) {
    h *= CALIB_CONFIG.highXGDecay;
    a *= CALIB_CONFIG.highXGDecay;
  }
  
  // Tight xG races deserve a draw boost.
  if (Math.abs(diffXG) < CALIB_CONFIG.tightXGDiff) {
    d *= 1 + CALIB_CONFIG.tightXGDrawBoost;
  }
  
  // Very open games reduce draw likelihood.
  if (totalXG > CALIB_CONFIG.openGameThreshold) {
    d *= Math.max(0, 1 - CALIB_CONFIG.openGameDrawPenalty);
  }
  
  // Strong domination boosts the favored side.
  if (diffXG > CALIB_CONFIG.strongDominationDiff) {
    h *= 1 + CALIB_CONFIG.homeDominationBoost;
  } else if (diffXG < -CALIB_CONFIG.strongDominationDiff) {
    a *= 1 + CALIB_CONFIG.awayDominationBoost;
  }
  
  h = clamp(h, 1e-6, 1);
  d = clamp(d, 1e-6, 1);
  a = clamp(a, 1e-6, 1);
  
  const sum = h + d + a;
  
  if (!Number.isFinite(sum) || sum <= 0) {
    return fallback;
  }
  
  return {
    homeWin: h / sum,
    draw: d / sum,
    awayWin: a / sum,
  };
}

// ============================================
// xG Calculation
// ============================================

function calculateExpectedGoals(
  subjectInfo,
  opponentInfo,
  isSubjectHome,
  isNeutral = false
) {
  if (!subjectInfo || !opponentInfo) return null;
  
  const {
    data: subject,
    leagueAvgXG: subjectLeagueAvg,
    leagueName: subjectLeague,
  } = subjectInfo;
  
  const {
    data: opponent,
    leagueAvgXG: oppLeagueAvg,
    leagueName: oppLeague,
  } = opponentInfo;
  
  if (!subject || !opponent) return null;
  
  const subjectLeagueAverage = Math.max(0.1, safeNumber(subjectLeagueAvg, 1.2));
  const oppLeagueAverage = Math.max(0.1, safeNumber(oppLeagueAvg, 1.2));
  
  const rawAvg = (subjectLeagueAverage + oppLeagueAverage) / 2;
  
  // Legacy guard:
  // If an old stats file stored TOTAL match xG instead of per-team xG,
  // this prevents catastrophic scaling.
  let teamLeagueAvg = rawAvg > 2.0 ? rawAvg / 2 : rawAvg;
  teamLeagueAvg = Math.max(0.1, teamLeagueAvg);
  
  const stat = (value, fallback = teamLeagueAvg) => {
    const n = safeNumber(value, fallback);
    return n > 0 ? n : fallback;
  };
  
  const seasonAttack = isNeutral ?
    (stat(subject.homeXG) + stat(subject.awayXG)) / 2 :
    isSubjectHome ?
    stat(subject.homeXG) :
    stat(subject.awayXG);
  
  const seasonDefense = isNeutral ?
    (stat(opponent.homeXGA) + stat(opponent.awayXGA)) / 2 :
    isSubjectHome ?
    stat(opponent.awayXGA) :
    stat(opponent.homeXGA);
  
  let recentAttack = weightedAverage(subject.last6XG);
  if (recentAttack <= 0) recentAttack = seasonAttack;
  
  let recentDefense = weightedAverage(opponent.last6XGA);
  if (recentDefense <= 0) recentDefense = seasonDefense;
  
  const blendedAttack =
    seasonAttack * MODEL_CONFIG.seasonWeight +
    recentAttack * MODEL_CONFIG.formWeight;
  
  const blendedDefense = Math.max(
    0.1,
    seasonDefense * MODEL_CONFIG.seasonWeight +
    recentDefense * MODEL_CONFIG.formWeight
  );
  
  let baseXG = (blendedAttack * blendedDefense) / teamLeagueAvg;
  
  const strengthDiff = blendedAttack - blendedDefense;
  const cappedDiff = clamp(strengthDiff, -1, 1);
  baseXG *= 1 + MODEL_CONFIG.strengthDiffMultiplier * cappedDiff;
  
  const subjectTotalEvents =
    (stat(subject.homeXG) +
      stat(subject.homeXGA) +
      stat(subject.awayXG) +
      stat(subject.awayXGA)) /
    2;
  
  const opponentTotalEvents =
    (stat(opponent.homeXG) +
      stat(opponent.homeXGA) +
      stat(opponent.awayXG) +
      stat(opponent.awayXGA)) /
    2;
  
  const matchTempo = (subjectTotalEvents + opponentTotalEvents) / 2;
  
  if (matchTempo < MODEL_CONFIG.lowTempoThreshold) {
    baseXG *= MODEL_CONFIG.lowTempoMultiplier;
  }
  
  if (matchTempo > MODEL_CONFIG.highTempoThreshold) {
    baseXG *= MODEL_CONFIG.highTempoMultiplier;
  }
  
  baseXG =
    baseXG * (1 - MODEL_CONFIG.leagueNormWeight) +
    teamLeagueAvg * MODEL_CONFIG.leagueNormWeight;
  
  if (isSubjectHome && !isNeutral) {
    const travelSickness = stat(opponent.awayXGA) - stat(opponent.homeXGA);
    
    if (travelSickness > 0.3) {
      baseXG *= MODEL_CONFIG.asymmetryBoost;
    }
  }
  
  if (subjectLeague && oppLeague && subjectLeague !== oppLeague) {
    const subjStrength = safeNumber(leagueStrength[subjectLeague], 1.0);
    const oppStrength = safeNumber(leagueStrength[oppLeague], 1.0);
    
    if (oppStrength > 0) {
      baseXG *= subjStrength / oppStrength;
    }
  }
  
  return clamp(baseXG, MODEL_CONFIG.xGMin, MODEL_CONFIG.xGMax);
}

function calculateLambda3(homeXG, awayXG) {
  const h = safeNumber(homeXG, 0);
  const a = safeNumber(awayXG, 0);
  const total = h + a;
  
  let lambda =
    MODEL_CONFIG.lambda3Base + MODEL_CONFIG.lambda3Slope * (total - 2);
  
  lambda = clamp(lambda, MODEL_CONFIG.lambda3Min, MODEL_CONFIG.lambda3Max);
  
  // Coherent BTTS/tempo/imbalance adjustment:
  // Instead of mutating final BTTS probability, adjust the shared Poisson component.
  if (total < MODEL_CONFIG.bttsLowTempoThreshold) {
    lambda *= MODEL_CONFIG.bttsLowTempoPenalty;
  }
  
  const imbalance = Math.abs(h - a);
  
  if (imbalance > MODEL_CONFIG.bttsImbalanceThreshold) {
    lambda *= MODEL_CONFIG.bttsImbalancePenalty;
  }
  
  // The shared component cannot exceed either marginal mean.
  lambda = clamp(lambda, 0, Math.max(0, Math.min(h, a)));
  
  return lambda;
}

function toOdds(probability) {
  const p = safeNumber(probability, 0);
  
  if (p <= 0) {
    return MODEL_CONFIG.maxFairOdds.toFixed(2);
  }
  
  if (p >= 1) {
    return "1.00";
  }
  
  return clamp(1 / p, 1.0, MODEL_CONFIG.maxFairOdds).toFixed(2);
}


// ============================================
// Match Prediction
// ============================================

function predictMatch(home, away, lg, isNeutral = false) {
  const homeInfo = getTeamData(home);
  const awayInfo = getTeamData(away);
  
  if (!homeInfo || !awayInfo) return null;
  
  const homeXG = calculateExpectedGoals(homeInfo, awayInfo, true, isNeutral);
  const awayXG = calculateExpectedGoals(awayInfo, homeInfo, false, isNeutral);
  
  if (!Number.isFinite(homeXG) || !Number.isFinite(awayXG)) {
    return null;
  }
  
  const lambda3 = calculateLambda3(homeXG, awayXG);
  
  const homeBaseXG = Math.max(0, homeXG - lambda3);
  const awayBaseXG = Math.max(0, awayXG - lambda3);
  
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
  
  const homePoissonCache = new Float64Array(MAX_GOALS + 1);
  const awayPoissonCache = new Float64Array(MAX_GOALS + 1);
  const l3PoissonCache = new Float64Array(MAX_GOALS + 1);
  
  for (let i = 0; i <= MAX_GOALS; i++) {
    homePoissonCache[i] = poisson(homeBaseXG, i);
    awayPoissonCache[i] = poisson(awayBaseXG, i);
    l3PoissonCache[i] = poisson(lambda3, i);
  }
  
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      let prob = 0;
      const maxK = Math.min(h, a);
      
      for (let k = 0; k <= maxK; k++) {
        prob +=
          homePoissonCache[h - k] *
          awayPoissonCache[a - k] *
          l3PoissonCache[k];
      }
      
      if (!Number.isFinite(prob)) prob = 0;
      
      totalMass += prob;
      
      if (h + a <= 1) under15 += prob;
      if (h + a <= 2) under25 += prob;
      if (h + a <= 3) under35 += prob;
      
      if (h >= 1 && a >= 1) btts += prob;
      
      if (h > a) _homeWin += prob;
      else if (h === a) _draw += prob;
      else _awayWin += prob;
      
      scorelinesList.push({
        score: `${h}-${a}`,
        prob,
      });
    }
  }
  
  if (!Number.isFinite(totalMass) || totalMass <= 0) {
    return null;
  }
  
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
  
  const calibrated = calibrate1X2(_homeWin, _draw, _awayWin, homeXG, awayXG);
  
  const totalXG = homeXG + awayXG;
  
  btts = clamp(btts, 0.001, 0.999);
  
  const topScorelines = scorelinesList
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3)
    .map((item) => ({
      score: item.score,
      probability: toOdds(item.prob),
    }));
  
  const league =
    lg || homeInfo.leagueName || awayInfo.leagueName || "Unknown";
  
  return {
    match: {
      homeTeam: home,
      awayTeam: away,
    },
    league,
    xG: {
      home: homeXG.toFixed(2),
      away: awayXG.toFixed(2),
      total: totalXG.toFixed(2),
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
      homeWin: toOdds(calibrated.homeWin),
      draw: toOdds(calibrated.draw),
      awayWin: toOdds(calibrated.awayWin),
    },
    topScorelines,
  };
}

// ============================================
// ROI / Edge Computation
// ============================================

function makeEmptyRoi() {
  return {
    edge: 0,
    edgeDisplay: "—",
    marketOdds: null,
    fairOdds: null,
    hClass: "low",
  };
}

function formatEdge(edge) {
  const e = safeNumber(edge, NaN);
  
  if (!Number.isFinite(e)) return "—";
  
  const pct = Math.abs(e * 100).toFixed(2);
  
  if (e > 0) return `+${pct}%`;
  if (e < 0) return `-${pct}%`;
  
  return "0.00%";
}

function setPairClasses(result, leftKey, rightKey) {
  const left = result[leftKey];
  const right = result[rightKey];
  
  if (!left || !right) return;
  
  const leftPositive = Number.isFinite(left.edge) && left.edge > 0;
  const rightPositive = Number.isFinite(right.edge) && right.edge > 0;
  
  if (left.edge === right.edge) {
    const cls = leftPositive ? "high" : "low";
    left.hClass = cls;
    right.hClass = cls;
    return;
  }
  
  if (left.edge > right.edge) {
    left.hClass = leftPositive ? "high" : "low";
    right.hClass = "low";
  } else {
    right.hClass = rightPositive ? "high" : "low";
    left.hClass = "low";
  }
}

function computeROI(data) {
  const { odds, oneX2, OU15, OU25, OU35, BTTS } = data || {};
  
  const groups = [
  {
    source: oneX2,
    mappings: [
      { outKey: "homeWin", marketKey: "Home", predKey: "homeWin" },
      { outKey: "draw", marketKey: "Draw", predKey: "draw" },
      { outKey: "awayWin", marketKey: "Away", predKey: "awayWin" },
    ],
  },
  {
    source: OU15,
    mappings: [
      { outKey: "over15", marketKey: "Over", predKey: "over15" },
      { outKey: "under15", marketKey: "Under", predKey: "under15" },
    ],
  },
  {
    source: OU25,
    mappings: [
      { outKey: "over25", marketKey: "Over", predKey: "over25" },
      { outKey: "under25", marketKey: "Under", predKey: "under25" },
    ],
  },
  {
    source: OU35,
    mappings: [
      { outKey: "over35", marketKey: "Over", predKey: "over35" },
      { outKey: "under35", marketKey: "Under", predKey: "under35" },
    ],
  },
  {
    source: BTTS,
    mappings: [
      { outKey: "bttsYes", marketKey: "BTTS", predKey: "gg" },
      { outKey: "bttsNo", marketKey: "BTTSN", predKey: "ng" },
    ],
  }, ];
  
  const result = {};
  
  for (const group of groups) {
    for (const m of group.mappings) {
      result[m.outKey] = makeEmptyRoi();
      
      if (!group.source) continue;
      
      const predVal = safeNumber(odds?.[m.predKey], 0);
      const marketVal = safeNumber(group.source?.[m.marketKey], 0);
      
      if (predVal >= 1.0 && marketVal > 1.0) {
        const edge = marketVal / predVal - 1;
        const roundedEdge = parseFloat(edge.toFixed(4));
        
        result[m.outKey] = {
          edge: roundedEdge,
          edgeDisplay: formatEdge(roundedEdge),
          marketOdds: marketVal,
          fairOdds: predVal,
          hClass: roundedEdge > 0 ? "high" : "low",
        };
      }
    }
  }
  
  const pairMappings = [
    ["over15", "under15"],
    ["over25", "under25"],
    ["over35", "under35"],
    ["bttsYes", "bttsNo"],
  ];
  
  for (const [key, otherKey] of pairMappings) {
    setPairClasses(result, key, otherKey);
  }
  
  const oneX2Keys = ["homeWin", "draw", "awayWin"].filter(
    (k) => result[k] && Number.isFinite(result[k].edge)
  );
  
  const positiveOneX2 = oneX2Keys.filter((k) => result[k].edge > 0);
  
  if (positiveOneX2.length > 0) {
    const maxEdge = Math.max(...positiveOneX2.map((k) => result[k].edge));
    
    for (const k of oneX2Keys) {
      result[k].hClass = result[k].edge >= maxEdge ? "high" : "low";
    }
  } else {
    for (const k of oneX2Keys) {
      result[k].hClass = "low";
    }
  }
  
  return result;
}

// ============================================
// Multi-Match Processor
// ============================================

function displayOdd(value) {
  const n = safeNumber(value, NaN);
  return Number.isFinite(n) && n > 1 ? n.toFixed(2) : "—";
}

function normalizeOverUnder(source) {
  return {
    Over: displayOdd(source?.Over),
    Under: displayOdd(source?.Under),
  };
}

function normalizeBTTS(source) {
  return {
    BTTS: displayOdd(source?.BTTS),
    BTTSN: displayOdd(source?.BTTSN),
  };
}

function normalize1X2(source) {
  return {
    Home: displayOdd(source?.Home),
    Draw: displayOdd(source?.Draw),
    Away: displayOdd(source?.Away),
  };
}

const formattedDates = new Map();
const predictedMatches = new Set();

async function predictMultiMatch(fixtures) {
  const outArr = [];
  const missingTeams = new Set();
  
  if (!Array.isArray(fixtures)) {
    return outArr;
  }
  
  for (const fixture of fixtures) {
    const {
      homeTeam,
      awayTeam,
      league,
      isNeutral = false,
      startDate,
      markets,
    } = fixture || {};
    
    let keyOfPredicted = `${homeTeam} vs ${awayTeam}`;
    
    const isPredicted = predictedMatches.has(keyOfPredicted);
    
    if (!homeTeam || !awayTeam || isPredicted) continue;
    
    const homeExists = Boolean(getTeamData(homeTeam));
    const awayExists = Boolean(getTeamData(awayTeam));
    
    if (!homeExists) missingTeams.add(homeTeam);
    if (!awayExists) missingTeams.add(awayTeam);
    if (!homeExists || !awayExists) continue;
    
    const dateObj = startDate ? new Date(startDate) : new Date();
    let fullDate = Number.isNaN(dateObj.getTime()) ?
      String(startDate || "") :
      dateObj.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }) +
      ` (${dateObj.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        })})`;
    
    if (formattedDates.has(fullDate)) {
      fullDate = formattedDates.get(fullDate);
    } else {
      
      const dateSplitted = fullDate.split(':')[0];
      
      const hour = parseInt(dateSplitted.slice(dateSplitted.indexOf('(') + 1));
      
      const WAThr = hour === 23 ? "00" : `${hour + 1}`;
      
      const dateKey = fullDate;
      
      fullDate = fullDate.replace(`${hour}:`, `${WAThr}:`);
      
      formattedDates.set(dateKey, fullDate);
    }
    
    const safeMarkets =
      markets && typeof markets === "object" ? markets : {};
    
    const { OverUnder, BTTS, "1X2": oneX2 } = safeMarkets;
    
    const rawOU15 = OverUnder?.["OU1.5"] ?? null;
    const rawOU25 = OverUnder?.["OU2.5"] ?? null;
    const rawOU35 = OverUnder?.["OU3.5"] ?? null;
    
    const prediction = predictMatch(homeTeam, awayTeam, league, isNeutral);
    
    if (!prediction) continue;
    
    const withOdds = {
      ...prediction,
      fullDate,
      oneX2: oneX2 ?? {},
      OU15: rawOU15 ?? {},
      OU25: rawOU25 ?? {},
      OU35: rawOU35 ?? {},
      BTTS: BTTS ?? {},
    };
    
    const edge = computeROI(withOdds);
    
    outArr.push({
      ...withOdds,
      ...edge,
      oneX2: normalize1X2(oneX2),
      OU15: normalizeOverUnder(rawOU15),
      OU25: normalizeOverUnder(rawOU25),
      OU35: normalizeOverUnder(rawOU35),
      BTTS: normalizeBTTS(BTTS),
    });
    
    predictedMatches.add(keyOfPredicted);
  }
  
  if (missingTeams.size > 0) {
    console.warn("Missing Teams in Dataset:", [...missingTeams]);
  }
  
  return outArr;
}

export { predictMatch, predictMultiMatch };