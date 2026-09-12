const axios = require('axios');

const halfUrl = 'https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/';

const secondHalf = '/participantStats/group/';

const thirdHalf = '?limit=30&locale=en';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://www.livescore.com',
  'Referer': 'https://www.livescore.com/',
  'Connection': 'keep-alive',
};

const LeagueIDs = {
  'EPL': '65',
  'La_Liga': '75',
  'Bundesliga': '67',
  'Ligue_1': '68',
  'Serie_A': '77',
  'Eredivisie': '64',
  'Championship': '70',
}


async function getMiscStats(league, statType = "shots_on_target") {
  const id = LeagueIDs[league];
  
  if (!id) return null;
  
  const url = halfUrl + id + secondHalf + statType + thirdHalf;
  
  try {
    const response = await axios.get(url, { headers });
    return response.data;
  } catch (error) {
    console.error('❌ Request failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Message:', error.message);
    }
  };
}


(async () => {
  const data = await getMiscStats('EPL');
  console.log(JSON.stringify(data, null, 2));
})();

//https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/shots_on_target?limit=3&locale=en

// https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/assist?limit=3&locale=en


// https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/shots?limit=3&locale=en

// https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/successful_tackles?limit=3&locale=en

// https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/interceptions?limit=3&locale=en

// https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/fouls_commited?limit=3&locale=en

// https://prod-cdn-stats-api.lsmedia1.com/api/v1/competition/75/participantStats/group/yellow_cards?limit=3&locale=en
