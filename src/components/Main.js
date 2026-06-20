import { Component } from "valen";
import Button from '../widgets/Button.js';
import MatchCard from '../MatchCard.js';
import predictMultiMatch from '../model/utils.js';

function Main() {
  return {
    state: {
      isLoading: false
    },
    created(state) {
      this.ran = false;
      this.runPredictions = async function() {
        if (state.isLoading) return;
        
        state.isLoading = true;
        await new Promise(resolve => setTimeout(resolve, 50));
        
        try {
          const predictions = predictMultiMatch([
            ["PSG", "Aston Villa", "UEFA Super Cup - Final", true],
            ["PSG", "Aston Villa", "UEFA Super Cup - Final", true]
          ]);
          
          if (this.ran) {
            MatchCard.set(predictions);
          } else {
            MatchCard.renderWith(predictions);
            this.ran = true;
          }
        } catch (err) {
          console.error('Prediction failed:' + err);
        } finally {
          state.isLoading = false;
        }
      };
    },
    template: () => {
      return `
      <div class="main-container">
        <h1 class="title">⚽ Football Prediction Model</h1>
        <p class="subtitle">Enhanced with finishing factors · Monte Carlo 150k sims · BTTS & Over/Under 2.5 focused</p>

        <div id="predictions-grid"></div>

        <Button {
          label: "[ isLoading ? 'Running…' : 'Run Predictions' ]",
          disabled: "[ isLoading ]",
          click: "this.runPredictions()"
        } />
      </div>
    `;
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
      color: #f4f4f5; /* Zinc-100: Bright but softer than pure white */
      font-size: 1.8rem;
      font-weight: 800;
      margin: 0 0 0.5rem 0;
      letter-spacing: -0.5px;
    `,
      ".subtitle": `
      color: #a1a1aa; /* Zinc-400: Matches the subtext in the MatchCard */
      margin-bottom: 2.5rem;
      font-size: 0.9rem;
      font-weight: 500;
      max-width: 600px;
      line-height: 1.5;
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
  }
};

export default Component(Main);