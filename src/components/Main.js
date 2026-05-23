import { Component } from "queflow";
import Button from '../nuggets/Button.js';
import MatchCard from '../MatchCard.js';
import predictMultiMatch from '../model/utils.js';

const Main = new Component("Main", {
  data: {
    isLoading: false
  },
  created: function() {
    this.ran = false;
    this.runPredictions = async function(data) {
      if (data.isLoading) return;
      
      data.isLoading = true;
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const predictions = predictMultiMatch([
          ["Celta", "Sevilla"],
          ["Alaves", "Vallecano"],
          ["Espanyol", "Sociedad"],
          ["Getafe", "Osasuna"],
          ["Girona", "Elche"],
          ["Mallorca", "Oviedo"],
          ["Betis", "Levante"],
          ["Real Madrid", "Athletic Club"],
          ["Valencia", "Barcelona"],
          ["Bologna", "Inter"],
          ["Lazio", "Pisa"],
          ["Bayern", "Stuttgart", "DFB Pokal - Final", true],
          ["Brighton", "Man Utd"],
          ["Burnley", "Wolves"],
          ["Crystal Palace", "Arsenal"],
          ["Fulham", "Newcastle"],
          ["Liverpool", "Brentford"],
          ["Man City", "Aston Villa"],
          ["Nottingham", "Bournemouth"],
          ["Sunderland", "Chelsea"],
          ["Tottenham", "Everton"],
          ["West Ham", "Leeds"],
          ["Villarreal", "Atletico"],
          ["Parma", "Sassuolo"],
          ["Napoli", "Udinese"],
          ["AC Milan", "Cagliari"],
          ["Cremonese", "Como"],
          ["Verona", "Roma"],
          ["Lecce", "Genoa"],
          ["Torino", "Juventus"]
        ]);
        
        if (this.ran) {
          MatchCard.set(predictions);
        } else {
          MatchCard.renderWith(predictions);
          this.ran = true;
        }
      } catch (err) {
        console.error('Prediction failed:', err);
      } finally {
        data.isLoading = false;
      }
    };
  },
  
  template: () => {
    return `
      <h1>⚽ Football Prediction Model</h1>
      <p class="subtitle">Enhanced with finishing factors · Monte Carlo 150k sims · BTTS & Over/Under 2.5 focused</p>

      <div id="predictions-grid"></div>

      <Button {
        label: "{{ isLoading ? 'Running…' : 'Run Predictions' }}",
        disabled: "{{ isLoading }}",
        click: "this.runPredictions(data)"
      } />
    `;
  },
  
  stylesheet: {
    ".subtitle": `
      color: #888;
      margin-bottom: 2.5rem;
      font-size: 1rem;
      font-weight: 400;
    `,
    "#predictions-grid": `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
      width: 100%;
      max-width: 1200px;
      margin: 0 auto 100px;   /* space for fixed button */
    `
  }
});

export default Main;