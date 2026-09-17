const fetch = require("node-fetch")
// forecast-raw.js
// Node.js 18+ (uses built-in fetch)

const BASE_URL = "https://api.xgscore.io";

const HEADERS = {
  "Content-Type": "application/json",
  "Accept-Language": "en",
  "x-utc-offset": "1",
  "x-geolocation": "NG",
  "Accept": "application/json, text/plain, */*",
};

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET", headers: HEADERS });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}


/**
 * Market definitions.
 * key      -> raw field name from the API/DB row
 * name     -> human readable field name in the output
 * columns  -> meaning of each element inside a row
 *
 * Every row has the shape: [label, probability, trend, spread]
 * (adjust `columns` if your third/fourth values mean something else)
 */
const MARKETS = {
  r:    { name: 'matchResult',     columns: ['outcome', 'probability', 'trend', 'spread'] },
  dc:   { name: 'doubleChance',    columns: ['outcome', 'probability', 'trend', 'spread'] },
  bts:  { name: 'bothTeamsToScore',columns: ['outcome', 'probability', 'trend', 'spread'] },
  tm:   { name: 'totalGoalsOver',  columns: ['line', 'probability', 'trend', 'spread'] },
  tl:   { name: 'totalGoalsUnder', columns: ['line', 'probability', 'trend', 'spread'] },
  itm1: { name: 'homeTotalOver',   columns: ['line', 'probability', 'trend', 'spread'] },
  itl1: { name: 'homeTotalUnder',  columns: ['line', 'probability', 'trend', 'spread'] },
  itm2: { name: 'awayTotalOver',   columns: ['line', 'probability', 'trend', 'spread'] },
  itl2: { name: 'awayTotalUnder',  columns: ['line', 'probability', 'trend', 'spread'] },
  h1:   { name: 'handicapHome',    columns: ['line', 'probability', 'trend', 'spread'] },
  h2:   { name: 'handicapAway',    columns: ['line', 'probability', 'trend', 'spread'] },
  dwnb: { name: 'drawNoBet',       columns: ['outcome', 'probability', 'trend', 'spread'] },
  cs:   { name: 'correctScore',    columns: ['score', 'probability', 'trend', 'spread'] },
};

/** Safely turn a JSON-string / array into an array. Returns null when empty. */
function parseRows(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null; // malformed -> treat as "no data" instead of throwing
  }
}

/** Turn one raw row array into a named object. */
function rowToObject(row, columns) {
  return Object.fromEntries(
    columns.map((col, i) => [col, row[i] ?? null])
  );
}

/**
 * Main formatter.
 * @param {object} raw - the forecast record (stringified matrices are fine)
 * @returns {object} readable forecast object
 */
function formatForecast(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const out = {};

  for (const [key, value] of Object.entries(raw)) {
    const market = MARKETS[key];

    // Not a matrix field (id, gameId, timestamps, ...) -> copy as-is
    if (!market) {
      out[key] = value;
      continue;
    }

    const rows = parseRows(value);
    out[market.name] = rows
      ? rows.map((row) => rowToObject(row, market.columns))
      : null;
  }

  return out;
}




async function main() {
  // 1. Premium predictions (raw JSON)
  //console.log("=== /forecasts/premium/public ===\n");
  const forecasts = await fetchJson(`${BASE_URL}/forecasts/premium/public`);
  //console.log(JSON.stringify(forecasts, null, 2));
  
  // 2. Odds for each game (raw JSON)
  console.log("\n=== /forecast-odds/public (per gameId) ===\n");
  
  for (const forecast of forecasts) {
    const homeTeam = forecast.game.teams.h.name;
    const awayTeam = forecast.game.teams.a.name;
    const { gameId } = forecast;
    console.log(`Match: ${homeTeam} vs ${awayTeam}\n--- gameId: ${gameId} ---\n`);
    
    try {
      const odds = await fetchJson(
        `${BASE_URL}/forecast-odds/public?gameId=${encodeURIComponent(gameId)}`
      );
      console.log(JSON.stringify(formatForecast(odds), null, 2));
    } catch (err) {
      console.error(`Failed: ${err.message}`);
    }
    
    console.log("");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
