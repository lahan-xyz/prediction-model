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
  //
  //  - League-normalized baseline. Preferred source is the
  //    `leagueAveragePPDA` field emitted by the generator (see
  //    LEAGUE_PPDA_BASELINES_FROM_DATA below). The hard-coded map is a
  //    fallback for older league_stats.js files that predate the field.
  //  - Primary signal lives on the DEFENSIVE side: opponent's press
  //    intensity scales their xGA contribution to our xG.
  //  - Attack term is a press MISMATCH (opponent press minus our press).
  //  - Venue fallback applies a home/away press delta.
  ppdaEnabled: true,
  ppdaBaseline: 13.0,           // fallback when nothing else is available
  ppdaScale: 3.5,
  ppdaUnknownIntensity: 0.5,
  ppdaAttackWeight: 0.08,       // press mismatch -> own xG
  ppdaDefenseWeight: 0.10,      // opponent press -> their xGA (primary)
  ppdaFacedWeight: 0.05,
  ppdaTempoWeight: 0.10,
  ppdaCorrelationWeight: 0.15,

  // PPDA-unit offset used when only one venue's PPDA is populated.
  // Home teams press more (lower PPDA), so:
  //   want home, have away -> subtract delta
  //   want away, have home -> add delta
  ppdaVenueFallbackDelta: 1.2,

  // ============================================
  // Tempo (continuous — replaces the old hard thresholds)
  // ============================================
  tempoNeutral: 3.0,
  tempoSlope: 0.10,
  tempoMinMult: 0.90,
  tempoMaxMult: 1.08,

  // ============================================
  // Optional Outcome Regression
  // ============================================
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

// [PPDA-BASELINE] Hard-coded fallback map. Used only when the generated
// league_stats.js doesn't carry a `leagueAveragePPDA` for a league, or when
// the league is unknown. Approximate means; update only if you must.
const LEAGUE_PPDA_BASELINES_FALLBACK = {
  EPL: 13.0,
  "La Liga": 15.0,
  Bundesliga: 11.0,
  "Serie A": 13.5,
  "Ligue 1": 14.5,
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

// Shared helper so predictMatch and calculateExpectedGoals agree on what
// "has tempo data" means. Prevents the two checks from drifting.
function hasTempoData(teamA, teamB) {
  if (!teamA || !teamB) return false;
  return [
    teamA.homeXG, teamA.awayXG, teamA.homeXGA, teamA.awayXGA,
    teamB.homeXG, teamB.awayXG, teamB.homeXGA, teamB.awayXGA,
  ].some((v) => safeNumber(v, 0) > 0);
}

// ============================================
// Team Data Index
// ============================================
//
// This avoids looping through every league and team on every prediction.

const TEAM_DATA_MAP = new Map();

// [PPDA-BASELINE] Data-driven league PPDA baselines. Populated from each
// league object's `leagueAveragePPDA` field when present. Falls back to
// LEAGUE_PPDA_BASELINES_FALLBACK at lookup time if a league is missing here.
const LEAGUE_PPDA_BASELINES_FROM_DATA = new Map();

for (const league of LEAGUES) {
  if (!league || typeof league !== "object") continue;

  const leagueAvgXG = safeNumber(league.leagueAverageXG, 1.2);
  const leagueName = league.leagueName || "Unknown";

  // [PPDA-BASELINE] Capture the generator-provided league average PPDA.
  const leagueAvgPPDA = safeNumber(league.leagueAveragePPDA, 0);
  if (leagueAvgPPDA > 0 && !LEAGUE_PPDA_BASELINES_FROM_DATA.has(leagueName)) {
    LEAGUE_PPDA_BASELINES_FROM_DATA.set(leagueName, leagueAvgPPDA);
  }

  for (const [teamName, entry] of Object.entries(league)) {
    if (teamName === "leagueAverageXG" || teamName === "leagueName") continue;
    if (teamName === "leagueAveragePPDA") continue;

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

// [PPDA-BASELINE] Resolves the effective PPDA baseline for a league.
// Priority:
//   1. Live value from the generated league_stats.js (leagueAveragePPDA).
//   2. Hard-coded fallback map (for older generated files).
//   3. Global MODEL_CONFIG.ppdaBaseline (unknown leagues).
function resolvePPDABaseline(leagueName) {
  if (leagueName) {
    const fromData = LEAGUE_PPDA_BASELINES_FROM_DATA.get(leagueName);
    if (Number.isFinite(fromData) && fromData > 0) return fromData;

    const fromFallback = LEAGUE_PPDA_BASELINES_FALLBACK[leagueName];
    if (Number.isFinite(fromFallback) && fromFallback > 0) return fromFallback;
  }

  return MODEL_CONFIG.ppdaBaseline;
}

// Accepts a league-specific baseline. A team at PPDA 10 in the Bundesliga
// lands near 0.5 intensity (neutral for them); the same PPDA in La Liga
// lands much higher.
function normalizePPDA(ppda, baseline = MODEL_CONFIG.ppdaBaseline) {
  const value = safeNumber(ppda, 0);

  if (value <= 0) {
    return MODEL_CONFIG.ppdaUnknownIntensity;
  }

  const z = clamp(
    (baseline - value) / Math.max(0.001, MODEL_CONFIG.ppdaScale),
    -4,
    4
  );

  return clamp(1 / (1 + Math.exp(-z)), 0, 1);
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

  // Fallback with a home/away press delta. Home teams press more, so their
  // PPDA is lower than their away PPDA. Without this, the one populated
  // venue leaked into the other slot 1:1.
  const delta = safeNumber(MODEL_CONFIG.ppdaVenueFallbackDelta, 1.2);

  if (isHome && away > 0) return Math.max(1, away - delta);
  if (!isHome && home > 0) return home + delta;

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

// Accepts the league name so it can pick the right PPDA baseline. Returns
// `baseline` in the result so it can be surfaced in the output.
function getPressMeta(team, isHome, isNeutral, leagueName) {
  const baseline = resolvePPDABaseline(leagueName);

  const fallback = {
    intensity: MODEL_CONFIG.ppdaUnknownIntensity,
    hasData: false,
    ppda: 0,
    baseline,
  };

  if (!MODEL_CONFIG.ppdaEnabled || !team) {
    return fallback;
  }

  const ppda = getTeamPPDA(team, isHome, isNeutral);

  if (ppda <= 0) {
    return fallback;
  }

  return {
    intensity: normalizePPDA(ppda, baseline),
    hasData: true,
    ppda,
    baseline,
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
  const closeness = clamp(
    1 - Math.abs(diffXG) / CALIB_CONFIG.tightXGDiff,
    0,
    1
  );

  const closenessFactor =
    1 + CALIB_CONFIG.tightXGDrawBoost * closeness;

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

  let blendedDefense = Math.max(
    0.1,
    seasonDefense * MODEL_CONFIG.seasonWeight +
      recentDefense * MODEL_CONFIG.formWeight
  );

  // ============================================
  // PPDA — Press metadata (league-normalized)
  // ============================================
  const subjectPressMeta = getPressMeta(
    subject,
    isSubjectHome,
    isNeutral,
    subjectLeague
  );

  const opponentPressMeta = getPressMeta(
    opponent,
    !isSubjectHome,
    isNeutral,
    oppLeague
  );

  // ============================================
  // PPDA — Defensive component (primary signal)
  // ============================================
  //
  // A high-pressing opponent concedes less than their raw xGA suggests.
  // Folded into blendedDefense BEFORE base xG is computed so it propagates
  // properly. Intensity is centered at 0.5, so a neutral press leaves
  // blendedDefense unchanged.
  if (MODEL_CONFIG.ppdaEnabled && opponentPressMeta.hasData) {
    const oppPressCentered = clamp(
      (opponentPressMeta.intensity - 0.5) * 2,
      -1,
      1
    );

    // Higher press -> lower xGA conceded -> lower our xG.
    blendedDefense *= 1 - MODEL_CONFIG.ppdaDefenseWeight * oppPressCentered;
    blendedDefense = Math.max(0.1, blendedDefense);
  }

  let baseXG = (blendedAttack * blendedDefense) / teamLeagueAvg;

  const strengthDiff = blendedAttack - blendedDefense;
  const cappedDiff = clamp(strengthDiff, -1, 1);
  baseXG *= 1 + MODEL_CONFIG.strengthDiffMultiplier * cappedDiff;

  // ============================================
  // PPDA — Press mismatch (secondary)
  // ============================================
  //
  // If the opponent presses harder than us, they leave space behind -> boost.
  // If we press harder than them, we're more exposed -> small penalty.
  if (
    MODEL_CONFIG.ppdaEnabled &&
    subjectPressMeta.hasData &&
    opponentPressMeta.hasData
  ) {
    const pressMismatch = clamp(
      opponentPressMeta.intensity - subjectPressMeta.intensity,
      -1,
      1
    );

    baseXG *= 1 + MODEL_CONFIG.ppdaAttackWeight * pressMismatch;
  }

  // ============================================
  // PPDA — Faced-press context (tertiary)
  // ============================================
  //
  // last6PPDA_A is treated as the PPDA of recent opponents against this team.
  // normalizePPDA uses the subject's league baseline for consistency with how
  // the opponent's intensity was computed.
  if (MODEL_CONFIG.ppdaEnabled && opponentPressMeta.hasData) {
    const facedPPDA = weightedAverage(subject.last6PPDA_A);

    if (facedPPDA > 0) {
      const facedIntensity = normalizePPDA(
        facedPPDA,
        subjectPressMeta.baseline
      );

      const pressDifficulty = clamp(
        opponentPressMeta.intensity - facedIntensity,
        -1,
        1
      );

      baseXG *= 1 - MODEL_CONFIG.ppdaFacedWeight * pressDifficulty;
    }
  }

  // ============================================
  // Tempo — continuous multiplier
  // ============================================
  //
  // Only applied when at least one side actually has tempo inputs, so
  // all-missing teams no longer silently drift into a low-tempo penalty.
  if (hasTempoData(subject, opponent)) {
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

    let matchTempo = (subjectTotalEvents + opponentTotalEvents) / 2;

    // PPDA nudge before the tempo multiplier.
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

      matchTempo *= clamp(
        1 + MODEL_CONFIG.ppdaTempoWeight * pressTempoShift,
        0.85,
        1.15
      );
    }

    const tempoDelta = matchTempo - MODEL_CONFIG.tempoNeutral;

    const tempoMult = clamp(
      1 + MODEL_CONFIG.tempoSlope * tempoDelta,
      MODEL_CONFIG.tempoMinMult,
      MODEL_CONFIG.tempoMaxMult
    );

    baseXG *= tempoMult;
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

  const homePressMeta = getPressMeta(
    homeInfo.data,
    true,
    isNeutral,
    homeInfo.leagueName
  );

  const awayPressMeta = getPressMeta(
    awayInfo.data,
    false,
    isNeutral,
    awayInfo.leagueName
  );

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
      homeBaseline: homePressMeta.baseline.toFixed(2),
      awayBaseline: awayPressMeta.baseline.toFixed(2),
      homeHasData: homePressMeta.hasData,
      awayHasData: awayPressMeta.hasData,
    },
    dataQuality: {
      tempoFromRealData: hasTempoData(homeInfo.data, awayInfo.data),
      pressFromRealData: homePressMeta.hasData && awayPressMeta.hasData,
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