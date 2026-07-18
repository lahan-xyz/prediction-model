import { Atom } from 'valen';

function MatchCard() {
  return {
    template: () => `
    <div class="match-card">
      <div class="match-meta">
        <span class="match-date">[ fullDate ]</span>
        <span class="badge">[ league ]</span>
      </div>

      <div class="match-header">
        <div class="teams">
          <span>[ match.homeTeam ] </span>
          <span class="vs">vs</span>
          <span> [ match.awayTeam ]</span>
        </div>
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
          
      <div class="odds-section">
        <div class="section-title">📊 Predicted & Bookie Odds</div>
        <div class="odds-grid">
          
          <!-- Over/Under 1.5 -->
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">Over 1.5</span>
              <span class="odd-odd">@ [ odds.over15 ] / [ OU15.Over ]</span>
            </div>
            <span class="odd-value [over15.hClass]">[ over15.edge > 0 ? '+'+over15.edge : over15.edge ]</span>
          </div>
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">Under 1.5</span>
              <span class="odd-odd">@ [ odds.under15 ] / [ OU15.Under ]</span>
            </div>
            <span class="odd-value [under15.hClass]">[ under15.edge > 0 ? '+'+under15.edge : under15.edge ]</span>
          </div>

          <!-- Over/Under 2.5 -->
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">Over 2.5</span>
              <span class="odd-odd">@ [ odds.over25 ] / [ OU25.Over ]</span>
            </div>
            <span class="odd-value [over25.hClass]">[ over25.edge > 0 ? '+'+over25.edge : over25.edge ]</span>
          </div>
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">Under 2.5</span>
              <span class="odd-odd">@ [ odds.under25 ] / [ OU25.Under ]</span>
            </div>
            <span class="odd-value [under25.hClass]">[ under25.edge > 0 ? '+'+under25.edge : under25.edge ]</span>
          </div>

          <!-- Over/Under 3.5 -->
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">Over 3.5</span>
              <span class="odd-odd">@ [ odds.over35 ] / [ OU35.Over ]</span>
            </div>
            <span class="odd-value [over35.hClass]">[ over35.edge > 0 ? '+'+over35.edge : over35.edge ]</span>
          </div>
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">Under 3.5</span>
              <span class="odd-odd">@ [ odds.under35 ] / [ OU35.Under ]</span>
            </div>
            <span class="odd-value [under35.hClass]">[ under35.edge > 0 ? '+'+under35.edge : under35.edge ]</span>
          </div>

          <!-- BTTS -->
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">BTTS (YES)</span>
              <span class="odd-odd">@ [ odds.gg ] / [ BTTS.BTTS ]</span>
            </div>
            <span class="odd-value [bttsYes.hClass]">[ bttsYes.edge > 0 ? '+'+bttsYes.edge : bttsYes.edge ]</span>
          </div>
          <div class="odd-box">
            <div class="odd-meta">
              <span class="odd-label">BTTS (NO)</span>
              <span class="odd-odd">@ [ odds.ng ] / [ BTTS.BTTSN ]</span>
            </div>
            <span class="odd-value [bttsNo.hClass]">[ bttsNo.edge > 0 ? '+'+bttsNo.edge : bttsNo.edge ]</span>
          </div>

        </div>
      </div>
                    
      <div class="outcome-row">
        <div class="outcome-item">
          <span class="outcome-label">Home</span>
          <span class="outcome-val home">@ [ odds.homeWin ] / [ oneX2.Home ]</span>
          <span class="outcome-odd [homeWin.hClass]">[ homeWin.edge > 0 ? '+'+homeWin.edge : homeWin.edge ]</span>
        </div>
        <div class="outcome-item">
          <span class="outcome-label">Draw</span>
          <span class="outcome-val draw">@ [ odds.draw ] / [ oneX2.Draw ]</span>
          <span class="outcome-odd mid">[ draw.edge > 0 ? '+'+draw.edge : draw.edge ]</span>
        </div>
        <div class="outcome-item">
          <span class="outcome-label">Away</span>
          <span class="outcome-val away">@ [ odds.awayWin ] / [ oneX2.Away ]</span>
          <span class="outcome-odd [awayWin.hClass]">[ awayWin.edge > 0 ? '+'+awayWin.edge : awayWin.edge ]</span>
        </div>
      </div>
                    
      <div>
        <div class="section-title">🎯 Top Scorelines</div>
        <div class="scorelines">
          <div class="score-badge mid">[ topScorelines[0].score ]
            <span class="odd">@ [ topScorelines[0].probability ]</span>
          </div>
          <div class="score-badge mid">[ topScorelines[1].score ] 
            <span>@ [ topScorelines[1].probability ]</span>
          </div>
          <div class="score-badge mid">[ topScorelines[2].score ] 
            <span>@ [ topScorelines[2].probability ]</span>
          </div>
        </div>
      </div>
                        
      <div class="note">Enhanced: NegBin + league blowout boost + zero-inflation</div>
    </div>`,

    stylesheet: {
      ".match-card": `
        box-sizing: border-box;
        width: 100; 
        background: rgb(33 22 3); /* 950 */
        border: 1px solid rgb(93 64 9 / 0.4); /* 800 */
        border-radius: 20px;
        padding: 1.6rem 1.4rem;
        margin-top: 0;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        display: flex;
        flex-direction: column;
        gap: 1.2rem;
        font-family: system-ui, -apple-system, sans-serif;
      `,
      ".match-card:hover": `
        border-color: rgb(140 96 13 / 0.7); /* 700 */
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgb(238 178 68 / 0.15); 
      `,
      
      // ----- match meta -----
      ".match-meta": `
        display: flex;
        justify-content: space-between;
        align-items: center;
      `,
      ".match-date": `
        font-size: 0.75rem;
        color: rgb(242 198 115 / 0.8); /* 300 */
        font-weight: 500;
      `,
      ".badge": `
        background: rgb(47 32 4); /* 900 */
        padding: 0.25rem 0.65rem;
        border-radius: 30px;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: rgb(246 217 162); /* 200 */
        border: 1px solid rgb(93 64 9 / 0.6);
      `,

      // ----- header -----
      ".match-header": `
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgb(93 64 9 / 0.4);
        padding-bottom: 0.75rem;
        margin-top: -0.25rem;
      `,
      ".teams": `
        font-size: 1.35rem;
        font-weight: 800;
        color: rgb(253 245 232); /* 50 */
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
      `,
      ".teams .vs": `
        color: rgb(187 127 17); /* 600 */
        font-weight: 500;
        font-size: 0.85rem;
        margin: 0 0.3rem;
      `,
      
      // ----- xG row -----
      ".xg-row": `
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgb(47 32 4); /* 900 */
        border-radius: 14px;
        padding: 0.75rem 1rem;
        gap: 0.5rem;
        border: 1px solid rgb(93 64 9 / 0.3);
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
        color: rgb(242 198 115 / 0.8); /* 300 muted */
        margin-bottom: 0.15rem;
      `,
      ".xg-value": `
        font-size: 1.5rem;
        font-weight: 700;
        color: rgb(253 245 232); /* 50 */
      `,
      ".xg-divider": `
        color: rgb(93 64 9); /* 800 */
        font-size: 1rem;
        font-weight: 300;
      `,
      ".xg-total": `
        background: rgb(93 64 9 / 0.5); /* 800 layout */
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.7rem;
        font-weight: 600;
        color: rgb(251 236 208); /* 100 */
        border: 1px solid rgb(140 96 13 / 0.4); /* 700 */
      `,
      ".correlation": `
        font-size: 0.65rem;
        color: rgb(140 96 13); /* 700 */
        text-align: right;
        margin-top: -0.4rem;
      `,
      
      // ----- odds & odds -----
      ".odds-section": `
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      `,
      ".section-title": `
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: rgb(242 198 115); /* 300 */
        margin-bottom: 0.4rem;
      `,
      ".odds-grid": `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
      `,
      ".odd-box": `
        background: rgb(47 32 4); /* 900 */
        border-radius: 12px;
        padding: 0.65rem 0.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border: 1px solid rgb(93 64 9 / 0.3);
      `,
      ".odd-meta": `
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
      `,
      ".odd-label": `
        font-size: 0.75rem;
        font-weight: 500;
        color: rgb(251 236 208); /* 100 */
      `,
      ".odd-odd": `
        font-size: 0.65rem;
        color: rgb(187 127 17); /* 600 */
        font-weight: 700;
      `,
      ".odd-value": `
        font-size: 0.95rem;
        font-weight: 700;
      `,
      ".high": `
        color: rgb(242 198 115); /* 300 */
      `,
      ".low": `
        color: rgb(140 96 13); /* 700 */
      `,
      
      // ----- 1X2 Outome & Market Odds -----
      ".outcome-row": `
        display: flex;
        justify-content: space-around;
        background: rgb(47 32 4); /* 900 */
        border-radius: 12px;
        padding: 0.75rem 0.2rem;
        border: 1px solid rgb(93 64 9 / 0.3);
      `,
      ".outcome-item": `
        text-align: center;
        flex: 1;
      `,
      ".outcome-label": `
        display: block;
        color: rgb(187 127 17); /* 600 */
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        margin-bottom: 0.1rem;
      `,
      ".outcome-val": `
        font-size: 0.7rem;
        color: rgb(238 178 68);
        font-weight: 500;
        display: block;
      `,
      ".outcome-odd": `
        display: block;
        font-size: 0.85rem;
        font-weight: 700;
        margin-top: 0.15rem;
      `,
      ".mid": "color: rgb(251 236 208);",      
      // ----- scorelines -----
      ".scorelines": `
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.3rem;
      `,
      ".score-badge": `
        background: rgb(47 32 4); /* 900 */
        border-radius: 20px;
        padding: 0.4rem 0.8rem;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.3px;
        color: rgb(253 245 232); /* 50 */
        border: 1px solid rgb(93 64 9 / 0.5);
        display: flex;
        align-items: center;
        gap: 0.4rem;
      `,
      ".score-badge.highlight": `
        background: rgb(233 159 22 / 0.1); 
        border-color: rgb(233 159 22 / 0.4);
        color: rgb(238 178 68); /* 400 */
      `,
      ".score-badge span": `
        color: rgb(242 198 115); /* 300 */
        font-weight: 500;
        font-size: 0.65rem;
      `,
      ".score-badge.highlight span": `
        color: rgb(251 236 208); /* 100 */
      `,
      
      ".note": `
        font-size: 0.65rem;
        color: rgb(140 96 13); /* 700 */
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
  };
}

export default Atom(MatchCard);