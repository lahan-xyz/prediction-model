import { Component } from "valen";
import Button from '../widgets/Button.js';
import MatchCard from '../MatchCard.js';
//import BettingCard from '../BettingCard.js';
import { predictMatch, predictMultiMatch } from '../model/utils.js';

function Main() {
  return {
    state: {
      isLoading: false,
      statusMsg: "Run Predictions"
    },
    created(state) {
      const toProb = (odd) => ((1 / parseFloat(odd)) * 100).toFixed(2) + "%";
      
      async function getFixturesNOdds(country) {
        try {
          const res = await fetch('http://localhost:3000/api/odds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              country
            })
          });
          
          const data = await res.json();
          return data;
        } catch (err) {
          console.error(err)
        }
      }
      
      this.runPredictions = async function() {
       /* BettingCard.renderWith({
             date: "26th May, 2015",
             market: "First Half over 1.5",
             homeTeam: "Chelsea",
             homeAvatar: "https://images.fotmob.com/image_resources/logo/teamlogo/8455.png",
             awayTeam: "PSG",
             awayAvatar: "https://images.fotmob.com/image_resources/logo/teamlogo/9847.png",
             probs: 0.65
           });*/
        
        if (state.isLoading) return;
        state.isLoading = true;
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        try {
          state.statusMsg = "Fetching Fixtures & odds...";
          const fixtures = await getFixturesNOdds("FRA");
 
          state.statusMsg = "Running Predictions...";
          
          // YIELD TO BROWSER: Allow the DOM to paint the new message before blocking the thread
          await new Promise(resolve => setTimeout(resolve, 50));
          
          const predictions = await predictMultiMatch(fixtures);
          const simplified = predictions.map(entry => {
            const { match, league, xG, fullDate, odds, topScorelines } = entry;
            
            return {
              date: fullDate,
              match,
              league,
              homeXG: xG.home,
              awayXG: xG.away,
              totalXG: xG.total,
              homeWinProbability: toProb(odds.homeWin),
              drawProbability: toProb(odds.draw),
              awayWinProbability: toProb(odds.awayWin),
              OVER_15: toProb(odds.over15),
              OVER_25: toProb(odds.over25),
              OVER_35: toProb(odds.over35),
              UNDER_15: toProb(odds.under15),
              UNDER_25: toProb(odds.under25),
              UNDER_35: toProb(odds.under35),
              BTTS_YES: toProb(odds.gg),
              BTTS_NO: toProb(odds.ng),
              TOPSCORELINE_1: topScorelines[0].score,
              TOPSCORELINE_2: topScorelines[1].score,
              TOPSCORELINE_3: topScorelines[2].score
            }
          })
          
          console.log(JSON.stringify(simplified, null, 2))
          //const predictions = await predictMatch("Bayern", "Stuttgart");
          
          if (MatchCard.isMounted) {
            MatchCard.set(predictions);
          } else {
            await MatchCard.renderWith(predictions);
          }
        } catch (err) {
          console.error('Prediction failed:' + err);
        } finally {
          state.statusMsg = "Run Predictions";
          state.isLoading = false;
        }
      }
    },
    
    template: () => {
      return `        
        <div class="main-container">
          <h1 class="title">⚽ Football Prediction Model</h1>          
          <p class="subtitle">Enhanced with finishing factors · Monte Carlo 150k sims · BTTS & Over/Under 2.5 focused</p>                    
          
          <div id="bcard-grid"></div>          
          <div id="predictions-grid"></div>                  
          
          <Button {            
            label: "[ statusMsg ]",            
            disabled: "[ isLoading ]",            
            click: "this.runPredictions()"          
          } />        
        </div>    `;
    },
    stylesheet: {
      /* Wraps everything to easily center the text block above the grid */
      ".main-container": `      
        display: flex;      
        flex-direction: column;      
        align-items: center;      
        text-align: center;      
        width: 100%;      
        padding: 2rem 1rem;      
        box-sizing: border-box;        
      `,
      ".title": `      
        color: rgb(253 245 232); /* 50 - Matching home team name exact color */      
        font-size: 1.8rem;      
        margin: 0 0 0.5rem 0;    
        font-weight: 700;
      `,
      ".subtitle": `        
        color: rgb(246 217 162 / 0.85); /* 200 with soft opacity */       
        margin-bottom: 2.5rem;        
        font-size: 0.9rem;        
        max-width: 600px;        
        line-height: 1.4;        
        font-weight: 300;    
      `,
      "#predictions-grid": `      
        display: grid;      
        /* Caps the card width at 450px so it doesn't stretch comically wide on desktop */      
        grid-template-columns: repeat(auto-fit, minmax(320px, 450px));      
        /* Forces the grid tracks to center within the 1200px container */      
        justify-content: center;       
        gap: 1.5rem;      
        width: 100%;      
        max-width: 1200px;      
        margin: 0 auto 100px auto; /* 100px bottom margin maintains space for your fixed button */    
      `
    }
  };
}

export default Component(Main);