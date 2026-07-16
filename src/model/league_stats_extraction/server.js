const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require('cheerio');

const app = express();

// Middleware,
app.use(cors());
app.use(express.json());

const extractData = (data) => {
    const roundTo2DP = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
    
    let league = {};
    var homeMatchesCount = 0,
        awayMatchesCount = 0;
    
    Object.values(data.teams).forEach((team) => {
        const teamName = team.title;
        
        homeMatchesCount = 0;
        awayMatchesCount = 0;
        
        var historyLen = team.history.length;
        let homeXG = 0,
            homeXGA = 0,
            awayXG = 0,
            awayXGA = 0,
            last6XG = [],
            last6XGA = [],
            last6Goals = [],
            last6GA = [],
            leagueAverageXG = 0;
        
        (team.history).forEach((match, i) => {
            const isHome = match.h_a === "h";
            
            match.xG = parseFloat(match.xG);
            match.xGA = parseFloat(match.xGA);
            
            if (isHome) {
                homeMatchesCount++;
                homeXG += match.xG;
                homeXGA += match.xGA;
            } else {
                awayMatchesCount++;
                awayXG += match.xG;
                awayXGA += match.xGA;
            }
            if (i >= historyLen - 6) {
                last6XG.push(roundTo2DP(match.xG));
                last6XGA.push(roundTo2DP(match.xGA));
                last6Goals.push(roundTo2DP(match.scored));
                last6GA.push(roundTo2DP(match.missed));
            }
        });
        
        league[teamName] = {
            homeXG: roundTo2DP(homeXG / homeMatchesCount),
            awayXG: roundTo2DP(awayXG / awayMatchesCount),
            homeXGA: roundTo2DP(homeXGA / homeMatchesCount),
            awayXGA: roundTo2DP(awayXGA / awayMatchesCount),
            last6XG: last6XG,
            last6XGA: last6XGA,
            last6Goals: last6Goals,
            last6GA: last6GA,
            homeMatchesCount,
            awayMatchesCount
        };
    });
    
    
    const computeLeagueAverage = (data) => {
        const keys = Object.keys(data),
            count = keys.length;
        let combinedXG = 0;
        for (let teamName of keys) {
            const team = data[teamName];
            combinedXG += ((team.homeXG * team.homeMatchesCount + team.awayXG * team.awayMatchesCount) / (homeMatchesCount + awayMatchesCount)) * 2;
            delete team.homeMatchesCount;
            delete team.awayMatchesCount;
        }
        return combinedXG / count;
    }
    
    league.leagueAverageXG = roundTo2DP(computeLeagueAverage(league));
    
    return league;
}


async function getLeagueData(league) {
    try {
        const url = `https://understat.com/getLeagueData/${league}/2025`;
        
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                "Referer": "https://understat.com/league/EPL",
                "Accept": "application/json, text/plain, */*",
                "X-Requested-With": "XMLHttpRequest"
            }
        });
        
        const data = response.data;
        const leagueData = extractData(data);
        
        return leagueData;
        
    } catch (error) {
        console.error("Error:", error.response?.status, error.message);
    }
}


app.post("/data", async (req, res) => {
    const leagueName = req.body.league;
    const leagueData = await getLeagueData(leagueName);
    const rawData = {
        data: {
            ...leagueData,
            leagueName: leagueName.replace("_", " ")
        }
    };
    
    res.json(rawData);
});


app.post("/processed", (req, res) => {
    const teamsData = req.body;
    console.log("Gotten back");
    const finalResult = {
        status: "Processed on backend"
    };
    
    res.json(finalResult);
});

// Start server
app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});


/*(async () => {
    const data = await getLeagueData("EPL")
    
})()*/