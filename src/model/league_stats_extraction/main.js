const before = ["Newcastle United", "Manchester City", "Manchester United", "Wolverhampton Wanderers", "Nottingham Forest", "Real Sociedad", "Atletico Madrid", "Rayo Vallecano", "Celta Vigo", "Real Betis", "Real Oviedo", "Paris Saint Germain", "Bayern Munich", "Hamburger SV", "Bayer Leverkusen", "Mainz 05", "Borussia Dortmund", "Borussia M.Gladbach", "Eintracht Frankfurt", "VfB Stuttgart", "FC Cologne", "RasenBallsport Leipzig", "FC Heidenheim", "Parma Calcio 1913",
  
  "Paris FC 98", "Stade Rennes",
  "Monchengladbach", "SV 07 Elversberg", "Hamburg", "Atl. Madrid", "Ath. Bilbao",
  "Coventry City", "Hull City", "Manchester Utd", "Leeds Utd", "Ipswich Town", "Newcastle Utd",
  "Deportivo La Coruna", "Racing Santander", "AC Milan", "Schalke 04"
];

const after = ["Newcastle", "Man City", "Man Utd", "Wolves", "Nottingham", "Sociedad", "Atletico", "Vallecano", "Celta", "Betis", "Oviedo", "PSG", "Bayern", "HSV", "Leverkusen", "Mainz", "Dortmund", "M'gladbach", "Frankfurt", "Stuttgart", "Cologne", "Leipzig", "Heidenheim", "Parma",
  
  "Paris FC", "Rennes", "M'gladbach", "Elversberg", "HSV", "Atletico", "Athletic Club",
  "Coventry", "Hull", "Man Utd", "Leeds", "Ipswich", "Newcastle",
  "Dep. La Coruna", "Santander", "Milan", "Schalke"
];

const simplifyTeamNames = (JSON) => {
  before.forEach((name, i) => JSON = JSON.replace(name, after[i]));
  
  return JSON;
}


async function processData() {
  const response = await fetch("http://localhost:3000/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ league: input.value || "EPL" })
  });
  
  const json = await response.json();
  const beautified = JSON.stringify(json.data, null, 2);
  const simplified = simplifyTeamNames(beautified);
  console.clear()
  console.log(simplified);
  //copyToClipboard(beautified);
  
  const res = await fetch("http://localhost:3000/processed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  
  const finalResult = await res.json();
  //console.log("Final backend result:", finalResult);
}

const simplifiedNames = new Map([
  ['AFC Bournemouth', 'Bournemouth'],
  ['Manchester United', 'Man Utd'],
  ['Manchester City', 'Man City'],
  ['Ipswich Town', 'Ipswich'],
  ['Leeds United', 'Leeds'],
  ['Hull City', 'Hull'],
  ['Nottingham Forest', 'Nottingham'],
  ['Coventry City', 'Coventry'],
  ['Newcastle United', 'Newcastle'],
  ['Tottenham Hotspur', 'Tottenham'],
  
  ['Real Betis', 'Betis'],
  ['Deportivo Alaves', 'Alaves'],
  ['Rayo Vallecano', 'Vallecano'],
  ['Real Sociedad', 'Sociedad'],
  ['Atletico Madrid', 'Atletico'],
  ['Racing Santander', 'Santander'],
  ['Deportivo A Coruna', 'Dep. La Coruna'],
  ['Celta Vigo', 'Celta'],
  
  ['RB Leipzig', 'Leipzig'],
  ['Bayern Munich', 'Bayern'],
  ['Borussia Dortmund', 'Dortmund'],
  ['Bayer Leverkusen', 'Leverkusen'],
  ['Union Berlin', ''],
  ['Mainz 05', 'Mainz'],
  ['VfB Stuttgart', 'Stuttgart'],
  ['Eintracht Frankfurt', 'Frankfurt'],
  ['Schalke 04', 'Schalke'],
  ['FC Cologne', 'Cologne'],
  ["Borussia M'gladbach", "M'gladbach"],
  ['Hamburger SV', 'HSV'],
  
  ['Paris Saint-Germain', 'PSG'],
  ['AS Monaco', 'Monaco'],
  
  ['AS Roma', 'Roma'],
  ['Como 1907', 'Como'],
  ['AC Milan', 'Milan']
]);

module.exports = { before, after, processData, simplifiedNames }