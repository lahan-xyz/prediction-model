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

  // Shared component (lambda3) can claim at most this fraction of whichever
  // side has the smaller expected goals, so that side always keeps some
  // independent scoring probability of its own.
  lambda3MaxShareOfMin: 0.85,

  bttsLowTempoPenalty: 0.92,
  bttsImbalancePenalty: 0.9,
  bttsImbalanceThreshold: 0.8,
  bttsLowTempoThreshold: 3.0,

  maxGoalsDeterministic: 10,
  xGMin: 0.1,
  xGMax: 5.5,
  recentFormLimit: 6,
  maxFairOdds: 999.99,

  // Band around the "was this stored as total-match xG instead of per-team
  // xG?" guess.
  legacyAvgBandLow: 1.8,
  legacyAvgBandHigh: 2.2,

  // ============================================
  // PPDA / Pressing Model
  // ============================================
  //
  // PPDA = Passes Allowed Per Defensive Action.
  // Lower PPDA means more aggressive pressing.
  // Higher PPDA means a more passive / deeper block.
  //
  // The model converts PPDA into a 0..1 pressing intensity score:
  // 0 = extremely passive
  // 0.5 = neutral / unknown
  // 1 = extremely aggressive press
  //
  // ppdaAttackWeight:
  //   If Team A presses more intensely than Team B, Team A gets a small xG boost.
  //   If Team B presses more intensely, Team A gets a small xG penalty.
  //
  // ppdaFacedWeight:
  //   Uses last6PPDA_A as the press difficulty a team has recently faced.
  //   If the current opponent presses harder than what the team is used to facing,
  //   apply a small suppression to that team's xG.
  //
  // ppdaTempoWeight:
  //   High-pressing matchups are generally more transitional and can raise tempo.
  //   Low-pressing matchups can reduce tempo.
  //
  // ppdaCorrelationWeight:
  //   High-pressing games can increase shared goal dependence / transitional chaos.
  //   This adjusts lambda3 slightly.
  ppdaEnabled: true,
  ppdaBaseline: 13.0,
  ppdaScale: 3.5,
  ppdaUnknownIntensity: 0.5,
  ppdaAttackWeight: 0.05,
  ppdaFacedWeight: 0.03,
  ppdaTempoWeight: 0.08,
  ppdaCorrelationWeight: 0.12,

  // ============================================
  // Optional Outcome Regression
  // ============================================
  //
  // last6Goals and last6GA are noisy results, not underlying quality.
  // These settings apply only a very small regression toward actual outcomes.
  // Set outcomeEnabled to false if you want a pure xG model.
  outcomeEnabled: true,
  outcomeAttackWeight: 0.05,
  outcomeDefenseWeight: 0.05,
  outcomeMaxDeviation: 0.35,
};

const CALIB_CONFIG = {
  highXGThreshold: 3.2,
  tightXGDiff: 0.4,
  tightXGDrawBoost: 0.25,
  openGameThreshold: 3.6,
  openGameDrawPenalty: 0.2,
  strongDominationDiff: 0.5,
  homeDominationBoost: 0.3,
  awayDominationBoost: 0.2,
};

const leagueStrength = {
  EPL: 1.0,
  "La Liga": 0.929,
  Bundesliga: 0.921,
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

  // Confirmed: last6XG/last6XGA/last6PPDA arrays are ordered oldest -> newest.
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
      "last6XG" in entry ||
      "homePPDA" in entry ||
      "awayPPDA" in entry ||
      "last6PPDA" in entry ||
      "last6PPDA_A" in entry)
  );
}

// ============================================
// Team Data Index
// ============================================
//
// This avoids looping through every league and team on every prediction.

const TEAM_DATA_MAP = new Map();

for (const league of LEAGUES) {
  if (!league || typeof league !== "object") continue;

  const leagueAvgXG = safeNumber(league.leagueAverageXG, 1.2);
  const leagueName = league.leagueName || "Unknown";

  for (const [teamName, entry] of Object.entries(league)) {
    if (teamName === "leagueAverageXG" || teamName === "leagueName") continue;

    if (isTeamStats(entry) && !TEAM_DATA_MAP.has(teamName)) {
      TEAM_DATA_MAP.set(teamName, {
        data: entry,
        leagueAvgXG,
        leagueName,
      });
    }
  }
}

function getTeamData(team) {
  if (!team) return null;

  const key = String(team).trim();
  const found = TEAM_DATA_MAP.get(key);

  if (!found) {
    console.warn(`Can't find: '${team}'`);
    return null;
  }

  return {
    data: found.data,
    leagueAvgXG: found.leagueAvgXG,
    leagueName: found.leagueName,
  };
}

// ============================================
// PPDA Helpers
// ============================================

function normalizePPDA(ppda) {
  const value = safeNumber(ppda, 0);

  if (value <= 0) {
    return MODEL_CONFIG.ppdaUnknownIntensity;
  }

  // Lower PPDA -> higher pressing intensity.
  //
  // Logistic curve around ppdaBaseline.
  // Example with baseline 13 and scale 3.5:
  // PPDA 8  -> intensity around 0.80
  // PPDA 13 -> intensity around 0.50
  // PPDA 20 -> intensity around 0.12
  const z = clamp(
    (MODEL_CONFIG.ppdaBaseline - value) /
      Math.max(0.001, MODEL_CONFIG.ppdaScale),
    -4,
    4
  );

  const intensity = 1 / (1 + Math.exp(-z));

  return clamp(intensity, 0, 1);
}

function getSeasonPPDA(team, isHome, isNeutral) {
  if (!team) return 0;

  const home = safeNumber(team.homePPDA, 0);
  const away = safeNumber(team.awayPPDA, 0);

  if (isNeutral) {
    if (home > 0 && away > 0) return (home + away) / 2;
    if (home > 0) return home;
    if (away > 0) return away;
    return 0;
  }

  const venue = isHome ? home : away;

  if (venue > 0) return venue;

  // Fallback to opposite venue if only one side is available.
  if (home > 0) return home;
  if (away > 0) return away;

  return 0;
}

function getTeamPPDA(team, isHome, isNeutral) {
  if (!team) return 0;

  const season = getSeasonPPDA(team, isHome, isNeutral);
  const recent = weightedAverage(team.last6PPDA);

  if (season <= 0 && recent <= 0) return 0;
  if (season <= 0) return recent;
  if (recent <= 0) return season;

  return (
    season * MODEL_CONFIG.seasonWeight + recent * MODEL_CONFIG.formWeight
  );
}

function getPressMeta(team, isHome, isNeutral) {
  const fallback = {
    intensity: MODEL_CONFIG.ppdaUnknownIntensity,
    hasData: false,
    ppda: 0,
  };

  if (!MODEL_CONFIG.ppdaEnabled || !team) {
    return fallback;
  }

  const ppda = getTeamPPDA(team, isHome, isNeutral);

  if (ppda <= 0) {
    return fallback;
  }

  return {
    intensity: normalizePPDA(ppda),
    hasData: true,
    ppda,
  };
}

function outcomeFactorFromForm(formArray, expected, weight) {
  if (!MODEL_CONFIG.outcomeEnabled || weight <= 0) return 1;
  if (!Array.isArray(formArray) || formArray.length === 0) return 1;

  const observed = weightedAverage(formArray);
  const exp = safeNumber(expected, 0);

  if (exp <= 0) return 1;

  const deviation = clamp(
    observed / exp - 1,
    -MODEL_CONFIG.outcomeMaxDeviation,
    MODEL_CONFIG.outcomeMaxDeviation
  );

  return clamp(1 + weight * deviation, 0.85, 1.15);
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

  // --- Draw adjustment ------------------------------------------------
  //
  // Closeness: tighter xG race -> higher draw probability.
  const closeness = clamp(
    1 - Math.abs(diffXG) / CALIB_CONFIG.tightXGDiff,
    0,
    1
  );

  const closenessFactor =
    1 + CALIB_CONFIG.tightXGDrawBoost * closeness;

  // Openness: more combined xG -> lower draw probability.
  const openness = clamp(
    (totalXG - CALIB_CONFIG.highXGThreshold) /
      (CALIB_CONFIG.openGameThreshold - CALIB_CONFIG.highXGThreshold),
    0,
    1
  );

  const opennessFactor =
    1 - CALIB_CONFIG.openGameDrawPenalty * openness;

  d *= closenessFactor * opennessFactor;

  // --- Favorite adjustment ---------------------------------------------
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

  const subjectLeagueAverage = Math.max(
    0.1,
    safeNumber(subjectLeagueAvg, 1.2)
  );

  const oppLeagueAverage = Math.max(0.1, safeNumber(oppLeagueAvg, 1.2));

  const rawAvg = (subjectLeagueAverage + oppLeagueAverage) / 2;

  // Legacy guard for older data that may have stored total match xG
  // instead of per-team xG.
  const totalLikelihood = clamp(
    (rawAvg - MODEL_CONFIG.legacyAvgBandLow) /
      (MODEL_CONFIG.legacyAvgBandHigh - MODEL_CONFIG.legacyAvgBandLow),
    0,
    1
  );

  let teamLeagueAvg = rawAvg * (1 - totalLikelihood / 2);
  teamLeagueAvg = Math.max(0.1, teamLeagueAvg);

  const stat = (value, fallback = teamLeagueAvg) => {
    const n = safeNumber(value, fallback);
    return n > 0 ? n : fallback;
  };

  const seasonAttack = isNeutral
    ? (stat(subject.homeXG) + stat(subject.awayXG)) / 2
    : isSubjectHome
    ? stat(subject.homeXG)
    : stat(subject.awayXG);

  const seasonDefense = isNeutral
    ? (stat(opponent.homeXGA) + stat(opponent.awayXGA)) / 2
    : isSubjectHome
    ? stat(opponent.awayXGA)
    : stat(opponent.homeXGA);

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

  // ============================================
  // PPDA Adjustment
  // ============================================
  //
  // subjectPressMeta:
  //   How intensely the subject team presses.
  //
  // opponentPressMeta:
  //   How intensely the opponent presses.
  //
  // If subject presses much more intensely than opponent, subject gains
  // a small chance-creation advantage through higher turnovers.
  //
  // If opponent presses much more intensely, subject loses a little.

  const subjectPressMeta = getPressMeta(
    subject,
    isSubjectHome,
    isNeutral
  );

  const opponentPressMeta = getPressMeta(
    opponent,
    !isSubjectHome,
    isNeutral
  );

  if (
    MODEL_CONFIG.ppdaEnabled &&
    subjectPressMeta.hasData &&
    opponentPressMeta.hasData
  ) {
    const pressDiff = clamp(
      subjectPressMeta.intensity - opponentPressMeta.intensity,
      -1,
      1
    );

    baseXG *= 1 + MODEL_CONFIG.ppdaAttackWeight * pressDiff;
  }

  // ============================================
  // Faced-Press Context
  // ============================================
  //
  // last6PPDA_A is treated as the PPDA of recent opponents against this team.
  // Lower values mean this team has recently faced more aggressive presses.
  //
  // If the current opponent presses harder than the press difficulty this
  // team has recently faced, apply a small suppression.
  // If the current opponent presses less, apply a small boost.

  if (MODEL_CONFIG.ppdaEnabled && opponentPressMeta.hasData) {
    const facedPPDA = weightedAverage(subject.last6PPDA_A);

    if (facedPPDA > 0) {
      const facedIntensity = normalizePPDA(facedPPDA);

      const pressDifficulty = clamp(
        opponentPressMeta.intensity - facedIntensity,
        -1,
        1
      );

      baseXG *= 1 - MODEL_CONFIG.ppdaFacedWeight * pressDifficulty;
    }
  }

  // ============================================
  // Tempo Adjustment
  // ============================================

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

  const rawMatchTempo = (subjectTotalEvents + opponentTotalEvents) / 2;

  // PPDA tempo effect:
  // High pressing from both sides can increase transitional tempo.
  // Low pressing from both sides can reduce it.
  let matchTempo = rawMatchTempo;

  if (
    MODEL_CONFIG.ppdaEnabled &&
    (subjectPressMeta.hasData || opponentPressMeta.hasData)
  ) {
    const avgPressIntensity =
      (subjectPressMeta.intensity + opponentPressMeta.intensity) / 2;

    const pressTempoShift = clamp(
      (avgPressIntensity - 0.5) * 2,
      -1,
      1
    );

    matchTempo =
      rawMatchTempo *
      clamp(
        1 + MODEL_CONFIG.ppdaTempoWeight * pressTempoShift,
        0.85,
        1.15
      );
  }

  if (matchTempo < MODEL_CONFIG.lowTempoThreshold) {
    baseXG *= MODEL_CONFIG.lowTempoMultiplier;
  }

  if (matchTempo > MODEL_CONFIG.highTempoThreshold) {
    baseXG *= MODEL_CONFIG.highTempoMultiplier;
  }

  // League normalization.
  baseXG =
    baseXG * (1 - MODEL_CONFIG.leagueNormWeight) +
    teamLeagueAvg * MODEL_CONFIG.leagueNormWeight;

  // Travel sickness / home asymmetry.
  if (isSubjectHome && !isNeutral) {
    const travelSickness =
      stat(opponent.awayXGA) - stat(opponent.homeXGA);

    if (travelSickness > 0.3) {
      baseXG *= MODEL_CONFIG.asymmetryBoost;
    }
  }

  // Cross-league strength adjustment.
  if (subjectLeague && oppLeague && subjectLeague !== oppLeague) {
    const subjStrength = safeNumber(leagueStrength[subjectLeague], 1.0);
    const oppStrength = safeNumber(leagueStrength[oppLeague], 1.0);

    if (oppStrength > 0) {
      baseXG *= subjStrength / oppStrength;
    }
  }

  // ============================================
  // Optional Outcome Regression
  // ============================================
  //
  // This uses last6Goals and last6GA very lightly.
  // It is not the core of the model. xG remains primary.

  baseXG *= outcomeFactorFromForm(
    subject.last6Goals,
    blendedAttack,
    MODEL_CONFIG.outcomeAttackWeight
  );

  baseXG *= outcomeFactorFromForm(
    opponent.last6GA,
    blendedDefense,
    MODEL_CONFIG.outcomeDefenseWeight
  );

  return clamp(baseXG, MODEL_CONFIG.xGMin, MODEL_CONFIG.xGMax);
}

// ============================================
// Correlation / Shared Goals
// ============================================

function calculateLambda3(
  homeXG,
  awayXG,
  homePressIntensity = MODEL_CONFIG.ppdaUnknownIntensity,
  awayPressIntensity = MODEL_CONFIG.ppdaUnknownIntensity
) {
  const h = safeNumber(homeXG, 0);
  const a = safeNumber(awayXG, 0);
  const total = h + a;

  let lambda =
    MODEL_CONFIG.lambda3Base +
    MODEL_CONFIG.lambda3Slope * (total - 2);

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

  // PPDA correlation adjustment.
  //
  // High pressing games can create more transitional dependence between the
  // two scoring processes: one team's turnover can directly create the other
  // team's chance, and vice versa.
  //
  // Low-block, passive games usually have more independent scoring processes.
  if (MODEL_CONFIG.ppdaEnabled) {
    const avgPressIntensity = clamp(
      (safeNumber(homePressIntensity, MODEL_CONFIG.ppdaUnknownIntensity) +
        safeNumber(awayPressIntensity, MODEL_CONFIG.ppdaUnknownIntensity)) /
        2,
      0,
      1
    );

    const pressCorrelation = clamp((avgPressIntensity - 0.5) * 2, -1, 1);

    lambda *= 1 + MODEL_CONFIG.ppdaCorrelationWeight * pressCorrelation;

    lambda = clamp(
      lambda,
      MODEL_CONFIG.lambda3Min,
      MODEL_CONFIG.lambda3Max
    );
  }

  // The shared component can never exceed either marginal mean.
  const ceiling =
    Math.max(0, Math.min(h, a)) * MODEL_CONFIG.lambda3MaxShareOfMin;

  lambda = clamp(lambda, 0, ceiling);

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

  const homeXG = calculateExpectedGoals(
    homeInfo,
    awayInfo,
    true,
    isNeutral
  );

  const awayXG = calculateExpectedGoals(
    awayInfo,
    homeInfo,
    false,
    isNeutral
  );

  if (!Number.isFinite(homeXG) || !Number.isFinite(awayXG)) {
    return null;
  }

  const homePressMeta = getPressMeta(homeInfo.data, true, isNeutral);
  const awayPressMeta = getPressMeta(awayInfo.data, false, isNeutral);

  const lambda3 = calculateLambda3(
    homeXG,
    awayXG,
    homePressMeta.intensity,
    awayPressMeta.intensity
  );

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

  const calibrated = calibrate1X2(
    _homeWin,
    _draw,
    _awayWin,
    homeXG,
    awayXG
  );

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
    pressing: {
      homePPDA:
        homePressMeta.ppda > 0 ? homePressMeta.ppda.toFixed(2) : null,
      awayPPDA:
        awayPressMeta.ppda > 0 ? awayPressMeta.ppda.toFixed(2) : null,
      homeIntensity: homePressMeta.intensity.toFixed(3),
      awayIntensity: awayPressMeta.intensity.toFixed(3),
      homeHasData: homePressMeta.hasData,
      awayHasData: awayPressMeta.hasData,
    },
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
    },
  ];

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
    const maxEdge = Math.max(
      ...positiveOneX2.map((k) => result[k].edge)
    );

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

const FIXTURE_TIME_ZONE = "Africa/Lagos";

const fixtureDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: FIXTURE_TIME_ZONE,
});

const fixtureTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  timeZone: FIXTURE_TIME_ZONE,
});

function formatFixtureDate(startDate) {
  const dateObj = startDate ? new Date(startDate) : new Date();

  if (Number.isNaN(dateObj.getTime())) {
    return String(startDate || "");
  }

  const datePart = fixtureDateFormatter.format(dateObj);

  const timePart = fixtureTimeFormatter
    .format(dateObj)
    // Defensive: some engines render midnight as "24:00" instead of "00:00".
    .replace(/^24:/, "00:");

  return `${datePart} (${timePart})`;
}

async function predictMultiMatch(fixtures) {
  const outArr = [];
  const missingTeams = new Set();

  // Scoped to this call only.
  const seenInThisBatch = new Set();

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

    const keyOfPredicted = `${homeTeam} vs ${awayTeam}|${league ?? ""}|${
      startDate ?? ""
    }`;

    if (!homeTeam || !awayTeam || seenInThisBatch.has(keyOfPredicted)) {
      continue;
    }

    const homeExists = Boolean(getTeamData(homeTeam));
    const awayExists = Boolean(getTeamData(awayTeam));

    if (!homeExists) missingTeams.add(homeTeam);
    if (!awayExists) missingTeams.add(awayTeam);

    if (!homeExists || !awayExists) continue;

    const fullDate = formatFixtureDate(startDate);

    const safeMarkets =
      markets && typeof markets === "object" ? markets : {};

    const { OverUnder, BTTS, "1X2": oneX2 } = safeMarkets;

    const rawOU15 = OverUnder?.["OU1.5"] ?? null;
    const rawOU25 = OverUnder?.["OU2.5"] ?? null;
    const rawOU35 = OverUnder?.["OU3.5"] ?? null;

    const prediction = predictMatch(
      homeTeam,
      awayTeam,
      league,
      isNeutral
    );

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

    seenInThisBatch.add(keyOfPredicted);
  }

  if (missingTeams.size > 0) {
    console.warn("Missing Teams in Dataset:", [...missingTeams]);
  }

  return outArr;
}

export { predictMatch, predictMultiMatch };