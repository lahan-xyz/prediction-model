const express = require('express');
const fetch = require('node-fetch');
const app = express();
const { before, after } = require('../league_stats_extraction/main.js');


app.use(express.json())

const teamNames = new Map(before.map((name, i) => [name, after[i]]));

const ID = {
  ENG: [
    "170880", 
  
    "1590149",
    
    "990749"
  ],
  
  
  SPA: [
    "180928"
  ],
  
  
  GER: [
    "180923",
    
    "1594859",
    
    "184976"
  ],
  
  
  FRA: [
   "950503",
    
    "1580308"
  ],
  
  
  ITA: [
    "167856"
  ]
}

var ODDS = []

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // or your frontend domain
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

async function FETCH(endpoint) {
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://sports.bet9ja.com/',
      'Origin': 'https://sports.bet9ja.com',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache'
    },
    credentials: 'include' // if in browser, sends cookies
  });
  return response.json();
}

app.post('/api/odds', async (req, res) => {
  ODDS = [];
  
  const { country } = req.body;
  
  const ids = ID[country];
  
  if (!ids || !ids.length) {
    res.json([]);
    return;
  }
  
  for (const id of ids) {
    try {
      const endpoint = `https://sports.bet9ja.com/mobile/feapi/PalimpsestAjax/GetEventsInGroupV2?GROUPID=${id}&DISP=0&GROUPMARKETID=1&v_cache_version=1.318.4.243`;
      const data = await FETCH(endpoint);
      const odds = extractMatchOdds(data);
      ODDS.push(...odds);
    } catch (err) {
      console.log(err);
      //res.status(500).json({ error: err.message });
    }
  }
  
  res.json(ODDS);
});

/*
{
  "GN": "Premier League", // Tournament/League name
  "SG": "England", // Country or region (SG = Sport Group/Region)
  "S": "Soccer", // Sport name
  "GID": 170880, // League/Tournament ID
  "SGID": 11058, // Country/Region ID
  "SID": 1 // Sport ID
  
}
*/
function extractMatchOdds(jsonData) {
  const events = jsonData.D?.E;
  const league = jsonData.D?.GN;
  const country = jsonData.D?.SG;
  
  if (!events || !Array.isArray(events)) {
  	  console.log(jsonData);
    return [];
  }
  
  return events.map(event => {
    // Parse teams from display string "Home - Away"
    let [homeTeam, awayTeam] = event.DS.split(' - ').map(s => s.trim());
    
    homeTeam = teamNames.get(homeTeam) || homeTeam;
    
    awayTeam = teamNames.get(awayTeam) || awayTeam;
    
    // Get odds object (safely)
    const O = event.O || {};
    const AUX = event.AUX || {};
    
    // --- 1X2 (Match Result) ---
    // Keys: S_1X2_1 = Home Win, S_1X2_X = Draw, S_1X2_2 = Away Win
    const homeWin = O.S_1X2_1;
    const draw = O.S_1X2_X;
    const awayWin = O.S_1X2_2;
    
    const ouLines = [1.5, 2.5, 3.5];
    const overUnder = {};
    
    ouLines.forEach(line => {
      const overKey = `S_OU@${line}_O`;
      const underKey = `S_OU@${line}_U`;
      overUnder[`OU${line}`] = {
        Over: O[overKey] || null,
        Under: O[underKey] || null
      };
    });
    
    const btts = {
      BTTS: O.S_GGNG_Y || null, // Both teams score
      BTTSN: O.S_GGNG_N || null // At least one team fails to score
    };
    
    return {
      homeTeam,
      awayTeam,
      matchId: event.ID,
      startDate: event.STARTDATE,
      league,
      country,
      
      // Requested markets
      markets: {
        '1X2': {
          Home: homeWin,
          Draw: draw,
          Away: awayWin
        },
        OverUnder: overUnder,
        BTTS: btts
      }
    };
  });
}

/*(async (arg) => console.log(FETCH("https://www.fotmob.com/api/data/leagueseasondeepstats?lng=en-GB&id=48&season=23744&type=teams&stat=expected_goals_team")))()*/

app.listen(3000, () => console.log('Proxy running on http://localhost:3000'));


/*
const fetch = require('node-fetch'); // or use built‑in fetch

async function fetchMatches() {
  const response = await fetch('https://www.msport.com/api/ng/facts-center/query/frontend/sports-matches-list?sportId=sr:sport:1', {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, *\/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json',
      'operId': '2',
      'nation': 'ng',
      'true-nation': 'NG',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: JSON.stringify(['sr:tournament:35'])
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return await response.json();
}

fetchMatches()
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error(err));
**/
