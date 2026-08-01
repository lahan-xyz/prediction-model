const fs = require("fs/promises");
const path = require("path");
const fetch = require("node-fetch");
const { before, after } = require("./main.js");
// ============================================
// Config
// ============================================

const LEAGUES = [
  {
    exportName: "EPL",
    understat: "EPL",
    displayName: "EPL",
  },
  {
    exportName: "LALIGA",
    understat: "La_Liga",
    displayName: "La Liga",
  },
  {
    exportName: "LIGUE1",
    understat: "Ligue_1",
    displayName: "Ligue 1",
  },
  {
    exportName: "BUNDESLIGA",
    understat: "Bundesliga",
    displayName: "Bundesliga",
  },
  {
    exportName: "SERIEA",
    understat: "Serie_A",
    displayName: "Serie A",
  },
];

// Example:
// node server.js
// SEASON=2025 node server.js
const SEASON = 2025 || defaultSeason();

// Saves to ../league_stats.js relative to this file
const OUTPUT_PATH = path.resolve(
  __dirname,
  process.env.OUTPUT_PATH || "../league_stats.js"
);

const REQUEST_DELAY_MS = Math.max(
  0,
  Number(process.env.REQUEST_DELAY_MS || 1200)
);

const MAX_RETRIES = Math.max(1, Number(process.env.MAX_RETRIES || 3));

// ============================================
// Helpers
// ============================================

function defaultSeason() {
  const now = new Date();

  // If August or later, use current year.
  // Otherwise use previous year.
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
          `Invalid JSON response from ${url}. This may mean Understat returned HTML or blocked the request.`
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

function computeLeagueAverage(teamsObj) {
  let totalXG = 0;
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

      totalXG += weightedTeamXG;
      totalTeamMatches += totalMatches;
    }

    // These are only needed for calculation.
    // Remove them before writing to league_stats.js.
    delete team.homeMatchesCount;
    delete team.awayMatchesCount;
  }

  // IMPORTANT:
  // This returns PER-TEAM average xG.
  // Example: 1.36 means average team xG per match.
  return safeDiv(totalXG, totalTeamMatches, 0);
}

function extractData(data, displayName) {
  const teamsObj = {};

  if (
    !data ||
    typeof data !== "object" ||
    !data.teams ||
    typeof data.teams !== "object"
  ) {
    return {
      leagueName: displayName,
      leagueAverageXG: 0,
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

    const last6XG = [];
    const last6XGA = [];
    const last6Goals = [];
    const last6GA = [];

    // Understat history is normally chronological.
    // Last 6 entries should be the most recent 6 matches.
    const lastSix = history.slice(-6);

    for (const match of lastSix) {
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
      const xG = safeNumber(match.xG, 0);
      const xGA = safeNumber(match.xGA, 0);

      const isHome = match.h_a === "h";

      if (isHome) {
        homeMatchesCount += 1;
        homeXG += xG;
        homeXGA += xGA;
      } else {
        awayMatchesCount += 1;
        awayXG += xG;
        awayXGA += xGA;
      }
    }

    teamsObj[teamName] = {
      homeXG: roundTo2DP(safeDiv(homeXG, homeMatchesCount, 0)),
      awayXG: roundTo2DP(safeDiv(awayXG, awayMatchesCount, 0)),
      homeXGA: roundTo2DP(safeDiv(homeXGA, homeMatchesCount, 0)),
      awayXGA: roundTo2DP(safeDiv(awayXGA, awayMatchesCount, 0)),
      last6XG,
      last6XGA,
      last6Goals,
      last6GA,
      homeMatchesCount,
      awayMatchesCount,
    };
  }

  const leagueAverageXG = roundTo2DP(computeLeagueAverage(teamsObj));

  return {
    leagueName: displayName,
    leagueAverageXG,
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

  if (!data || typeof data !== "object" || !data.teams) {
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
    const stringed = JSON.stringify(statsObject).replaceAll("],", "],\n").replaceAll(',"', ',\n"');
    lines.push(
      `export const ${league.exportName} = ${stringed};`
    );

    lines.push(``);
  }

  lines.push(
    `export default { ${LEAGUES.map((league) => league.exportName).join(
      ", "
    )} };`
  );


  let final = lines.join("\n");
  
  for (let i = 0, len = before.length; i < len; i++) {
    final = final.replace(before[i], after[i]);
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

  for (const league of LEAGUES) {
    console.log(`Fetching ${league.displayName}...`);

    stats[league.exportName] = await getLeagueData(league);

    const teamCount =
      Object.keys(stats[league.exportName]).length - 2; // exclude leagueName + leagueAverageXG

    console.log(
      `Done: ${league.displayName} | Teams: ${teamCount} | League Avg xG: ${
        stats[league.exportName].leagueAverageXG
      }`
    );

    if (REQUEST_DELAY_MS > 0) {
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
