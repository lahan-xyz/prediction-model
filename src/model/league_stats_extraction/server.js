const fs = require("fs/promises");
const path = require("path");

// Use native fetch if available (Node 18+), otherwise fallback to node-fetch.
let fetch = globalThis.fetch;
if (!fetch) {
  fetch = require("node-fetch");
}

// ============================================
// Optional before/after replacements from main.js
// ============================================
//
// [FIX] Silently ignore MODULE_NOT_FOUND (main.js is optional). Only warn on
// genuinely broken main.js so the common case stays quiet.
let before = [];
let after = [];
try {
  const mainModule = require("./main.js");
  before = Array.isArray(mainModule.before) ? mainModule.before : [];
  after = Array.isArray(mainModule.after) ? mainModule.after : [];
} catch (e) {
  if (e && e.code !== "MODULE_NOT_FOUND") {
    console.warn(
      "Could not load ./main.js for before/after replacements:",
      e.message
    );
  }
}

// ============================================
// Config
// ============================================

const LEAGUES = [
  { exportName: "EPL", understat: "EPL", displayName: "EPL" },
  { exportName: "LALIGA", understat: "La_Liga", displayName: "La Liga" },
  { exportName: "LIGUE1", understat: "Ligue_1", displayName: "Ligue 1" },
  { exportName: "BUNDESLIGA", understat: "Bundesliga", displayName: "Bundesliga" },
  { exportName: "SERIEA", understat: "Serie_A", displayName: "Serie A" },
];

// [FIX] Explicit validation of SEASON so an invalid env value can't produce NaN.
function defaultSeason() {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

function resolveSeason() {
  const raw = process.env.SEASON;
  if (raw == null || raw === "") return defaultSeason();

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    console.warn(
      `Invalid SEASON="${raw}", falling back to ${defaultSeason()}`
    );
    return defaultSeason();
  }
  return n;
}

const SEASON = resolveSeason();

const OUTPUT_PATH = path.resolve(
  __dirname,
  process.env.OUTPUT_PATH || "../league_stats.js"
);

const REQUEST_DELAY_MS = Math.max(0, Number(process.env.REQUEST_DELAY_MS || 1200));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 3));

// Keys that are NOT teams in the exported league object. Used to count teams
// reliably instead of the fragile `length - 3` trick.
const LEAGUE_META_KEYS = new Set([
  "leagueName",
  "leagueAverageXG",
  "leagueAveragePPDA",
]);

// ============================================
// Helpers
// ============================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundTo2DP(value) {
  const n = safeNumber(value, 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safeDiv(numerator, denominator, fallback = 0) {
  const n = safeNumber(numerator, NaN);
  const d = safeNumber(denominator, 0);

  if (!Number.isFinite(n) || d <= 0) return fallback;

  return n / d;
}

// ============================================
// HTTP Fetching
// ============================================

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          Referer: "https://understat.com/",
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          `Invalid JSON response from ${url}. Understat may have returned HTML or blocked the request.`
        );
      }
    } catch (error) {
      lastError = error;

      console.warn(
        `Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${error.message}`
      );

      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError;
}

// ============================================
// Stats Processing
// ============================================

// Extracts one team's per-venue aggregates, last-6 arrays, and match counts.
//
// Returns an object that does NOT include match counts (they're internal
// bookkeeping). The caller accumulates league totals from the same local
// variables so no mutation of the output is needed.
function extractTeamStats(team) {
  const history = Array.isArray(team?.history) ? team.history : [];

  let homeMatchesCount = 0;
  let awayMatchesCount = 0;

  let homeXG = 0;
  let homeXGA = 0;
  let homePPDA = 0;

  let awayXG = 0;
  let awayXGA = 0;
  let awayPPDA = 0;

  const last6PPDA = [];
  const last6PPDA_A = [];
  const last6XG = [];
  const last6XGA = [];
  const last6Goals = [];
  const last6GA = [];

  // Last 6 matches, oldest -> newest. Understat history is chronological,
  // and utils1.js's weightedAverage treats arrays as oldest -> newest.
  const lastSix = history.slice(-6);
  for (const match of lastSix) {
    const ppda = match?.ppda || {};
    const ppdaAllowed = match?.ppda_allowed || {};

    last6PPDA.push(roundTo2DP(safeDiv(ppda.att, ppda.def, 0)));
    last6PPDA_A.push(roundTo2DP(safeDiv(ppdaAllowed.att, ppdaAllowed.def, 0)));

    last6XG.push(roundTo2DP(safeNumber(match?.xG, 0)));
    last6XGA.push(roundTo2DP(safeNumber(match?.xGA, 0)));
    last6Goals.push(
      roundTo2DP(safeNumber(match?.scored ?? match?.goals, 0))
    );
    last6GA.push(
      roundTo2DP(safeNumber(match?.missed ?? match?.conceded, 0))
    );
  }

  // Season aggregates by venue.
  for (const match of history) {
    const ppda = match?.ppda || {};
    const xG = safeNumber(match?.xG, 0);
    const xGA = safeNumber(match?.xGA, 0);
    const matchPPDA = safeDiv(ppda.att, ppda.def, 0);

    const isHome = match?.h_a === "h";

    if (isHome) {
      homeMatchesCount += 1;
      homePPDA += matchPPDA;
      homeXG += xG;
      homeXGA += xGA;
    } else {
      awayMatchesCount += 1;
      awayPPDA += matchPPDA;
      awayXG += xG;
      awayXGA += xGA;
    }
  }

  const homePPDAAvg = safeDiv(homePPDA, homeMatchesCount, 0);
  const awayPPDAAvg = safeDiv(awayPPDA, awayMatchesCount, 0);
  const homeXGAvg = safeDiv(homeXG, homeMatchesCount, 0);
  const awayXGAvg = safeDiv(awayXG, awayMatchesCount, 0);
  const homeXGAAvg = safeDiv(homeXGA, homeMatchesCount, 0);
  const awayXGAAvg = safeDiv(awayXGA, awayMatchesCount, 0);

  return {
    // Public fields written to league_stats.js
    stats: {
      homePPDA: roundTo2DP(homePPDAAvg),
      awayPPDA: roundTo2DP(awayPPDAAvg),
      homeXG: roundTo2DP(homeXGAvg),
      awayXG: roundTo2DP(awayXGAvg),
      homeXGA: roundTo2DP(homeXGAAvg),
      awayXGA: roundTo2DP(awayXGAAvg),
      last6PPDA,
      last6PPDA_A,
      last6XG,
      last6XGA,
      last6Goals,
      last6GA,
    },
    // Internal bookkeeping for computing league averages
    homeMatchesCount,
    awayMatchesCount,
    homeXGAvg,
    awayXGAvg,
    homePPDAAvg,
    awayPPDAAvg,
  };
}

function extractData(data, displayName) {
  if (!data?.teams || typeof data.teams !== "object") {
    return {
      leagueName: displayName,
      leagueAverageXG: 0,
      leagueAveragePPDA: 0,
    };
  }

  const teamsObj = {};

  // Match-weighted league totals. Computed alongside team extraction so we
  // never have to mutate teamsObj afterwards.
  let leagueXGSum = 0;
  let leaguePPDASum = 0;
  let leagueMatches = 0;

  for (const team of Object.values(data.teams)) {
    const teamName = team?.title;
    if (!teamName) continue;

    const extracted = extractTeamStats(team);

    teamsObj[teamName] = extracted.stats;

    const hm = extracted.homeMatchesCount;
    const am = extracted.awayMatchesCount;

    leagueXGSum += extracted.homeXGAvg * hm + extracted.awayXGAvg * am;
    leaguePPDASum += extracted.homePPDAAvg * hm + extracted.awayPPDAAvg * am;
    leagueMatches += hm + am;
  }

  return {
    leagueName: displayName,
    leagueAverageXG: roundTo2DP(safeDiv(leagueXGSum, leagueMatches, 0)),
    leagueAveragePPDA: roundTo2DP(safeDiv(leaguePPDASum, leagueMatches, 0)),
    ...teamsObj,
  };
}

// Counts teams in an exported league object without assuming a fixed number
// of metadata keys.
function countTeams(leagueStats) {
  if (!leagueStats || typeof leagueStats !== "object") return 0;
  return Object.keys(leagueStats).filter((k) => !LEAGUE_META_KEYS.has(k))
    .length;
}

// ============================================
// League Fetching
// ============================================

async function getLeagueData(league) {
  const url = `https://understat.com/getLeagueData/${encodeURIComponent(
    league.understat
  )}/${encodeURIComponent(SEASON)}`;

  const data = await fetchJson(url);

  if (!data?.teams) {
    throw new Error(
      `Invalid Understat payload for ${league.displayName} ${SEASON}`
    );
  }

  return extractData(data, league.displayName);
}

// ============================================
// File Generation
// ============================================

function serializeLeagueStatsModule(stats) {
  const lines = [];

  lines.push(`// Generated by server.js`);
  lines.push(`// Generated At: ${new Date().toISOString()}`);
  lines.push(`// Season: ${SEASON}`);
  lines.push(``);

  for (const league of LEAGUES) {
    const statsObject = stats[league.exportName];

    // Standard JSON pretty-print is safer and more readable than regex
    // replacements, and produces stable diffs across seasons.
    const stringed = JSON.stringify(statsObject, null, 2);

    lines.push(`export const ${league.exportName} = ${stringed};`);
    lines.push(``);
  }

  lines.push(
    `export default { ${LEAGUES.map((league) => league.exportName).join(", ")} };`
  );

  let final = lines.join("\n");

  // Apply any custom string replacements from main.js if they exist.
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0, len = Math.min(before.length, after.length); i < len; i++) {
      final = final.replaceAll(before[i], after[i]);
    }
  }

  return final;
}

// ============================================
// Main
// ============================================

async function main() {
  if (typeof fetch !== "function") {
    console.error(
      "Global fetch is not available. Use Node.js 18+ or install a fetch polyfill/axios."
    );
    process.exit(1);
  }

  console.log("==========================================");
  console.log("Understat League Stats Generator");
  console.log("==========================================");
  console.log(`Season: ${SEASON}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log("==========================================");

  const stats = {};

  for (let i = 0; i < LEAGUES.length; i++) {
    const league = LEAGUES[i];
    console.log(`Fetching ${league.displayName}...`);

    stats[league.exportName] = await getLeagueData(league);

    const teamCount = countTeams(stats[league.exportName]);

    console.log(
      `Done: ${league.displayName} | Teams: ${teamCount} | Avg xG: ${
        stats[league.exportName].leagueAverageXG
      } | Avg PPDA: ${stats[league.exportName].leagueAveragePPDA}`
    );

    if (REQUEST_DELAY_MS > 0 && i < LEAGUES.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const moduleText = serializeLeagueStatsModule(stats);

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, moduleText, "utf8");

  console.log("==========================================");
  console.log(`Successfully saved league stats to:`);
  console.log(OUTPUT_PATH);
  console.log("==========================================");
}

main().catch((error) => {
  console.error("Failed to generate league stats.");
  console.error(error);
  process.exit(1);
});
