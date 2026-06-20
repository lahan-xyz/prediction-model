import { Atom } from 'valen';

function MatchCard() {
  return {
    template: () => `
    <div class="match-card">
      <div class="match-header">
          <div class="teams">
            <span>[ match.homeTeam ] </span>
            <span class="vs">vs</span>
            <span> [ match.awayTeam ]</span>
          </div>
          <div class="badge">[ league ]</div>
       </div>
       
       <div class="xg-row">
         <div class="xg-item">
           <span class="xg-label">Home xG</span>
           <span class="xg-value">[ xG.home ]</span>
         </div>
         <div class="xg-divider">—</div>
         <div class="xg-item">
           <span class="xg-label">Away xG</span>
           <span class="xg-value">[ xG.away ]</span>
         </div>
         <div class="xg-total">Total [ xG.total ]</div>
       </div>
       <div class="correlation">Correlation λ₃: [ correlation ]</div>

        <div class="probs-section">
          <div class="section-title">📊 Probabilities</div>
            <div class="probs-grid">
              <div class="prob-box">
                <span class="prob-label">Over 2.5</span>
                <span class="prob-value high">[ probabilities.over25 ]%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">Under 2.5</span>
                <span class="prob-value low">[ probabilities.under25 ]%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">BTTS (GG)</span>
                <span class="prob-value med">[ probabilities.gg ]%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">BTTS (NO)</span>
                <span class="prob-value low">[ probabilities.ng ]%</span>
              </div>
               <div class="prob-box">
                <span class="prob-label">Odd Goals</span>
                <span class="prob-value odd">[ oddProb ]%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">Even Goals</span>
                <span class="prob-value even">[ evenProb ]%</span>
              </div>
            </div>
          </div>

          <div class="outcome-row">
            <div class="outcome-item">
              <span class="outcome-label">Home</span> 
              <span class="outcome-val home">[ probabilities.homeWin ]%</span>
            </div>
            <div class="outcome-item">
              <span class="outcome-label">Draw</span> 
              <span class="outcome-val draw">[ probabilities.draw ]%</span>
            </div>
            <div class="outcome-item">
              <span class="outcome-label">Away</span> 
              <span class="outcome-val away">[ probabilities.awayWin ]%</span>
            </div>
          </div>

          <div>
            <div class="section-title">🎯 Top Scorelines</div>
              <div class="scorelines">
                <div class="score-badge">[ topScorelines[0].score ]
                <span class="prob">[ topScorelines[0].probability ]%</span>
                </div>
                <div class="score-badge">[ topScorelines[1].score ] <span>[ topScorelines[1]. probability ]%</span>
                </div>
                <div class="score-badge">[ topScorelines[2].score ] <span>[ topScorelines[2]. probability ]%</span>
                </div>
              </div>
            </div>
            <div class="note">Enhanced: NegBin + league blowout boost + zero-inflation
            </div>
          </div>`,
    stylesheet: {
      ".match-card": `
    box-sizing: border-box;
    width: 100%;
    background: #141417;
    border: 1px solid #232326;
    border-radius: 20px;
    padding: 1.6rem 1.4rem;
    margin-top: 0;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  `,
      ".match-card:hover": `
    border-color: #3f3f46;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
  `,
      
      // ----- header -----
      ".match-header": `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #232326;
    padding-bottom: 0.75rem;
  `,
      ".teams": `
    font-size: 1.25rem;
    font-weight: 700;
    color: #f4f4f5;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  `,
      ".teams .vs": `
    color: #71717a;
    font-weight: 500;
    font-size: 0.85rem;
    margin: 0 0.3rem;
  `,
      ".badge": `
    background: #1f1f23;
    padding: 0.3rem 0.8rem;
    border-radius: 30px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: #a1a1aa;
    border: 1px solid #2d2d31;
  `,
      
      // ----- xG row -----
      ".xg-row": `
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #09090b;
    border-radius: 14px;
    padding: 0.75rem 1rem;
    gap: 0.5rem;
    border: 1px solid #1f1f23;
  `,
      ".xg-item": `
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
  `,
      ".xg-label": `
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #71717a;
    margin-bottom: 0.15rem;
  `,
      ".xg-value": `
    font-size: 1.5rem;
    font-weight: 700;
    color: #f4f4f5;
  `,
      ".xg-divider": `
    color: #3f3f46;
    font-size: 1rem;
    font-weight: 300;
  `,
      ".xg-total": `
    background: #1f1f23;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.7rem;
    font-weight: 600;
    color: #e4e4e7;
    border: 1px solid #2d2d31;
  `,
      ".correlation": `
    font-size: 0.65rem;
    color: #52525b;
    text-align: right;
    margin-top: -0.4rem;
  `,
      
      // ----- probabilities -----
      ".probs-section": `
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  `,
      ".section-title": `
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #a1a1aa;
    margin-bottom: 0.4rem;
  `,
      ".probs-grid": `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  `,
      ".prob-box": `
    background: #09090b;
    border-radius: 12px;
    padding: 0.65rem 0.8rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #1f1f23;
  `,
      ".prob-label": `
    font-size: 0.75rem;
    font-weight: 500;
    color: #d4d4d8;
  `,
      ".prob-value": `
    font-size: 0.85rem;
    font-weight: 700;
  `,
      ".prob-value.high": `
    color: #10b981;
  `,
      ".prob-value.med": `
    color: #f59e0b;
  `,
      ".prob-value.low": `
    color: #f43f5e;
  `,
      ".prob-value.odd": `
    color: #a855f7;
    text-shadow: 0 0 12px rgba(168, 85, 247, 0.25);
  `,
      ".prob-value.even": `
    color: #06b6d4;
    text-shadow: 0 0 12px rgba(6, 182, 212, 0.25);
  `,
      
      // ----- 1X2 -----
      ".outcome-row": `
    display: flex;
    justify-content: space-around;
    background: #09090b;
    border-radius: 12px;
    padding: 0.75rem 0.2rem;
    border: 1px solid #1f1f23;
  `,
      ".outcome-item": `
    text-align: center;
    flex: 1;
  `,
      ".outcome-label": `
    display: block;
    color: #71717a;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    margin-bottom: 0.25rem;
  `,
      ".outcome-val": `
    font-size: 0.9rem;
    font-weight: 700;
  `,
      ".outcome-val.home": `
    color: #10b981;
  `,
      ".outcome-val.draw": `
    color: #f59e0b;
  `,
      ".outcome-val.away": `
    color: #f43f5e;
  `,
      
      // ----- scorelines -----
      ".scorelines": `
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.3rem;
  `,
      ".score-badge": `
    background: #1f1f23;
    border-radius: 20px;
    padding: 0.4rem 0.8rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: #e4e4e7;
    border: 1px solid #2d2d31;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  `,
      ".score-badge.highlight": `
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.3);
    color: #10b981;
  `,
      ".score-badge span": `
    color: #a1a1aa;
    font-weight: 500;
    font-size: 0.65rem;
  `,
      ".score-badge.highlight span": `
    color: #a7f3d0;
  `,
      
      ".note": `
    font-size: 0.65rem;
    color: #52525b;
    margin-top: 0.3rem;
    font-style: italic;
  `,
      
      // responsive
      "@media (max-width: 500px)": {
        ".match-card": `
      padding: 1.2rem;
    `
      }
    },
    isReactive: true,
    id: "predictions-grid"
  }
}

export default Atom(MatchCard);