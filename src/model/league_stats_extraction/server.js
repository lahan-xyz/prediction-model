const fs = require("fs/promises");
const path = require("path");

// Use native fetch if available (Node 18+), otherwise fallback to node-fetch
let fetch = globalThis.fetch;
if (!fetch) {
  fetch = require("node-fetch");
}

// Safely import before/after replacements from main.js if they exist
let before = [];
let after = [];
try {
  const mainModule = require("./main.js");
  before = mainModule.before || [];
  after = mainModule.after || [];
} catch (e) {
  // main.js might not exist or might not export before/after
  console.log("Error fetching './main.js'", e);
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

// Properly respect the SEASON environment variable
const SEASON = process.env.SEASON ? Number(process.env.SEASON) : defaultSeason();

const OUTPUT_PATH = path.resolve(
  __dirname,
  process.env.OUTPUT_PATH || "../league_stats.js"
);

const REQUEST_DELAY_MS = Math.max(0, Number(process.env.REQUEST_DELAY_MS || 1200));
const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 3));

// ============================================
// Helpers
// ============================================

function defaultSeason() {
  const now = new Date();
  // If August or later, use current year. Otherwise use previous year.
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
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

function computeLeagueAverages(teamsObj) {
  let totalXG = 0;
  let totalPPDA = 0;
  let totalTeamMatches = 0;
  
  for (const teamName of Object.keys(teamsObj)) {
    const team = teamsObj[teamName];
    const homeCount = safeNumber(team.homeMatchesCount, 0);
    const awayCount = safeNumber(team.awayMatchesCount, 0);
    const totalMatches = homeCount + awayCount;
    
    if (totalMatches > 0) {
      const weightedTeamXG =
        safeNumber(team.homeXG, 0) * homeCount +
        safeNumber(team.awayXG, 0) * awayCount;
      
      const weightedTeamPPDA =
        safeNumber(team.homePPDA, 0) * homeCount +
        safeNumber(team.awayPPDA, 0) * awayCount;
      
      totalXG += weightedTeamXG;
      totalPPDA += weightedTeamPPDA;
      totalTeamMatches += totalMatches;
    }
    
    // These are only needed for calculation.
    // Remove them before writing to league_stats.js.
    delete team.homeMatchesCount;
    delete team.awayMatchesCount;
  }
  
  return {
    leagueAverageXG: roundTo2DP(safeDiv(totalXG, totalTeamMatches, 0)),
    leagueAveragePPDA: roundTo2DP(safeDiv(totalPPDA, totalTeamMatches, 0)),
  };
}

function extractData(data, displayName) {
  const teamsObj = {};
  
  if (!data?.teams || typeof data.teams !== "object") {
    return {
      leagueName: displayName,
      leagueAverageXG: 0,
      leagueAveragePPDA: 0,
    };
  }
  
  const teams = Object.values(data.teams);
  
  for (const team of teams) {
    const teamName = team?.title;
    
    if (!teamName) continue;
    
    const history = Array.isArray(team.history) ? team.history : [];
    
    let homeMatchesCount = 0;
    let awayMatchesCount = 0;
    
    let homeXG = 0;
    let homeXGA = 0;
    
    let awayXG = 0;
    let awayXGA = 0;
    
    let homePPDA = 0;
    let awayPPDA = 0;
    
    const last6PPDA = [];
    const last6PPDA_A = [];
    
    const last6XG = [];
    const last6XGA = [];
    const last6Goals = [];
    const last6GA = [];
    
    const lastSix = history.slice(-6);
    for (const match of lastSix) {
      // Fallback to empty object to prevent crashes if Understat omits PPDA data
      const ppda = match.ppda || {};
      const ppda_a = match.ppda_allowed || {};
      
      last6PPDA.push(roundTo2DP(safeDiv(ppda.att, ppda.def, 0)));
      last6PPDA_A.push(roundTo2DP(safeDiv(ppda_a.att, ppda_a.def, 0)));
      
      last6XG.push(roundTo2DP(safeNumber(match.xG, 0)));
      last6XGA.push(roundTo2DP(safeNumber(match.xGA, 0)));
      last6Goals.push(
        roundTo2DP(safeNumber(match.scored ?? match.goals ?? 0, 0))
      );
      last6GA.push(
        roundTo2DP(safeNumber(match.missed ?? match.conceded ?? 0, 0))
      );
    }
    
    for (const match of history) {
      const ppda = match.ppda || {};
      const xG = safeNumber(match.xG, 0);
      const xGA = safeNumber(match.xGA, 0);
      const matchPPDA = safeDiv(ppda.att, ppda.def, 0);
      
      const isHome = match.h_a === "h";
      
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
    
    teamsObj[teamName] = {
      homePPDA: roundTo2DP(safeDiv(homePPDA, homeMatchesCount, 0)),
      awayPPDA: roundTo2DP(safeDiv(awayPPDA, awayMatchesCount, 0)),
      homeXG: roundTo2DP(safeDiv(homeXG, homeMatchesCount, 0)),
      awayXG: roundTo2DP(safeDiv(awayXG, awayMatchesCount, 0)),
      homeXGA: roundTo2DP(safeDiv(homeXGA, homeMatchesCount, 0)),
      awayXGA: roundTo2DP(safeDiv(awayXGA, awayMatchesCount, 0)),
      last6PPDA,
      last6PPDA_A,
      last6XG,
      last6XGA,
      last6Goals,
      last6GA,
      homeMatchesCount,
      awayMatchesCount,
    };
  }
  
  const averages = computeLeagueAverages(teamsObj);
  
  return {
    leagueName: displayName,
    leagueAverageXG: averages.leagueAverageXG,
    leagueAveragePPDA: averages.leagueAveragePPDA,
    ...teamsObj,
  };
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
    
    // Standard JSON pretty-print is much safer and more readable than regex replacements
    const stringed = JSON.stringify(statsObject, null, 2);
    
    lines.push(`export const ${league.exportName} = ${stringed};`);
    lines.push(``);
  }
  
  lines.push(
    `export default { ${LEAGUES.map((league) => league.exportName).join(", ")} };`
  );
  
  let final = lines.join("\n");
  
  // Apply any custom string replacements from main.js if they exist
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
    
    // -3 to exclude leagueName, leagueAverageXG, and leagueAveragePPDA
    const teamCount = Object.keys(stats[league.exportName]).length - 3;
    
    console.log(
      `Done: ${league.displayName} | Teams: ${teamCount} | Avg xG: ${
        stats[league.exportName].leagueAverageXG
      } | Avg PPDA: ${stats[league.exportName].leagueAveragePPDA}`
    );
    
    // Only sleep if this isn't the last league in the array
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
