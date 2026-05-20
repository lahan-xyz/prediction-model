import { Atom } from 'queflow';

const MatchCard = new Atom("MatchCard", {
  template: () => `
    <div class="match-card">
      <div class="match-header">
          <div class="teams">
            <span>{{ match.homeTeam }} </span>
            <span class="vs">vs</span>
            <span> {{ match.awayTeam }}</span>
          </div>
          <div class="badge">{{ league }}</div>
       </div>
       <div class="xg-row">
         <div class="xg-item">
           <span class="xg-label">Home xG</span>
           <span class="xg-value">{{ xG.home }}</span>
         </div>
         <div class="xg-divider">—</div>
         <div class="xg-item">
           <span class="xg-label">Away xG</span>
           <span class="xg-value">{{ xG.away }}</span>
         </div>
         <div class="xg-total">Total {{ xG.total }}</div>
       </div>
       <div class="correlation">Correlation λ₃: {{ correlation }}</div>

        <div class="probs-section">
          <div class="section-title">📊 Probabilities</div>
            <div class="probs-grid">
              <div class="prob-box">
                <span class="prob-label">Over 2.5</span>
                <span class="prob-value high">{{ probabilities.over25 }}%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">Under 2.5</span>
                <span class="prob-value low">{{ probabilities.under25 }}%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">BTTS (GG)</span>
                <span class="prob-value med">{{ probabilities.gg }}%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">BTTS (NO)</span>
                <span class="prob-value low">{{ probabilities.ng }}%</span>
              </div>
               <div class="prob-box">
                <span class="prob-label">Odd Goals</span>
                <span class="prob-value odd">{{ oddProb }}%</span>
              </div>
              <div class="prob-box">
                <span class="prob-label">Even Goals</span>
                <span class="prob-value even">{{ evenProb }}%</span>
              </div>
            </div>
          </div>

          <div class="outcome-row">
            <div class="outcome-item"><span>Home</span> <span color="#4ade80" font-weight="700">{{ probabilities.homeWin }}%</span>
            </div>
            <div class="outcome-item"><span>Draw</span> <span color="#facc15">{{ probabilities.draw }}%</span>
            </div>
            <div class="outcome-item"><span>Away</span> <span color="#f87171">{{ probabilities.awayWin }}%</span>
            </div>
          </div>

          <div>
            <div class="section-title" margin-bottom="0.4rem">🎯 Top Scorelines</div>
              <div class="scorelines">
                <div class="score-badge">{{ topScorelines[0].score }}
                <span class="prob">{{ topScorelines[0].probability }}%</span>
                </div>
                <div class="score-badge">{{ topScorelines[1].score }} <span>{{ topScorelines[1]. probability }}%</span>
                </div>
                <div class="score-badge">{{ topScorelines[2].score }} <span>{{ topScorelines[2]. probability }}%</span>
                </div>
              </div>
            </div>
            <div class="note">Enhanced: NegBin + league blowout boost + zero-inflation
            </div>
          </div>`,
  stylesheet: {
  ".match-card": `
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 20px;
    padding: 1.6rem 1.4rem;
    margin-top: 0;
    transition: border-color 0.15s;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  `,
  ".match-card:hover": `
    border-color: #555;
  `,
  
  // ----- header -----
  ".match-header": `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #222;
    padding-bottom: 0.75rem;
  `,
  ".teams": `
    font-size: 1.25rem;
    font-weight: 700;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  `,
  ".teams .vs": `
    color: #777;
    font-weight: 500;
    font-size: 0.85rem;
    margin: 0 0.3rem;
  `,
  ".badge": `
    background: #1a1a1a;
    padding: 0.3rem 0.8rem;
    border-radius: 30px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: #aaa;
    border: 1px solid #2a2a2a;
  `,
  
  // ----- xG row -----
  ".xg-row": `
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0c0c0c;
    border-radius: 14px;
    padding: 0.75rem 1rem;
    gap: 0.5rem;
    border: 1px solid #222;
  `,
  ".xg-item": `
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
  `,
  ".xg-label": `
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #666;
    margin-bottom: 0.15rem;
  `,
  ".xg-value": `
    font-size: 1.5rem;
    font-weight: 700;
    color: #fff;
  `,
  ".xg-divider": `
    color: #333;
    font-size: 1rem;
    font-weight: 300;
  `,
  ".xg-total": `
    background: #1a1a1a;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.7rem;
    font-weight: 600;
    color: #ccc;
    border: 1px solid #333;
  `,
  ".correlation": `
    font-size: 0.65rem;
    color: #666;
    text-align: right;
    margin-top: 0.2rem;
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
    color: #888;
  `,
  ".probs-grid": `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  `,
  ".prob-box": `
    background: #0c0c0c;
    border-radius: 12px;
    padding: 0.6rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #222;
  `,
  ".prob-label": `
    font-size: 0.75rem;
    font-weight: 500;
    color: #ccc;
  `,
  ".prob-value": `
    font-size: 0.85rem;
    font-weight: 700;
  `,
  ".prob-value.high": `
    color: #4ade80;
  `,
  ".prob-value.med": `
    color: #facc15;
  `,
  ".prob-value.low": `
    color: #f87171;
  `,
  ".prob-value.odd": `
      color: #c084fc;   /* soft purple for odd goals */
      text-shadow: 0 0 10px rgba(192, 132, 252, 0.4);
    `,
  ".prob-value.even": `
      color: #67e8f9;   /* cyan for even goals */
      text-shadow: 0 0 10px rgba(103, 232, 249, 0.4);
    `,
  // ----- 1X2 -----
  ".outcome-row": `
    display: flex;
    justify-content: space-around;
    background: #0c0c0c;
    border-radius: 12px;
    padding: 0.6rem 0.2rem;
    border: 1px solid #222;
  `,
  ".outcome-item": `
    text-align: center;
    font-weight: 600;
    font-size: 0.8rem;
    color: #eee;
  `,
  ".outcome-item span": `
    display: block;
    color: #777;
    font-size: 0.6rem;
    text-transform: uppercase;
    margin-bottom: 0.15rem;
  `,
  
  // ----- scorelines -----
  ".scorelines": `
    display: flex;
    gap: 0.5rem;
    margin-top: 0.3rem;
  `,
  ".score-badge": `
    background: #1a1a1a;
    border-radius: 20px;
    padding: 0.4rem 0.8rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
  `,
  ".score-badge span": `
    color: #aaa;
    font-weight: 400;
    font-size: 0.6rem;
  `,
  
  ".note": `
    font-size: 0.65rem;
    color: #555;
    margin-top: 0.3rem;
    font-style: italic;
  `,
  
  // responsive
  "@media (max-width: 500px)": {
    ".predictions-grid": `
      grid-template-columns: 1fr;
    `,
    ".match-card": `
      padding: 1.2rem;
    `
  }
},
  isReactive: true
}, "predictions-grid");

export default MatchCard;