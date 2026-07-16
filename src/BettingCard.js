import { Atom } from 'valen'

function BettingCard() {
  return {
    template: () => {
      return (`
        <div class="mc-card">
          <div class="mc-teams">
            <div class="mc-team">
              <img class="mc-avatar" src="[ homeAvatar ]" loading="lazy" alt="[ homeTeam ] logo" />
              <span class="mc-team-name">[ homeTeam ]</span>
            </div>
            
            <div class="mc-vs-badge">VS</div>
            
            <div class="mc-team">
              <img class="mc-avatar" src="[ awayAvatar ]" loading="lazy" alt="[ awayTeam ] logo" />
              <span class="mc-team-name">[ awayTeam ]</span>
            </div>
          </div>
          
          <div class="mc-details">
            <span class="mc-date">[ date ]</span>
            <div class="mc-market-badge">
              <span>[ market ]</span>
            </div>
          </div>
          

          
          <div class="mc-footer">
            <div class="mc-probss-btn">
              <span class="mc-probss-label">Probs</span>
              <span class="mc-probss-value">[ probs ]</span>
            </div>
          </div>
        </div>
      `)
    },
    
    stylesheet: {
      ".mc-card": `
        background: linear-gradient(135deg, rgb(47 32 4), rgb(33 22 3));
        border: 1px solid rgb(93 64 9 / 0.4);
        border-radius: 24px;
        padding: 1.75rem 1.5rem;
        margin-block: 2.5em;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        max-width: 420px;
        width: 100%;
        box-sizing: border-box;
        font-family: system-ui, -apple-system, sans-serif;
      `,
      ".mc-card:hover": `
        transform: translateY(-2px);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgb(238 178 68 / 0.3);
      `,
      
      // ----- details Zone -----
      ".mc-details": `
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: left;
        border-top: 1px solid rgb(93 64 9 / 0.3);
        padding-top: 0.85rem;
      `,
      ".mc-date": `
        font-size: 0.85rem;
        color: rgb(246 217 162); /* 200 */
        font-weight: 500;
        letter-spacing: 0.02em;
        margin-block: .3em;
      `,
      ".mc-market-badge": `
        width: auto;
        font-size: 1.05rem;
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.06em;
        background: rgb(93 64 9 / 0.5);
        color: rgb(242 198 115);
        padding: 0.3rem 0.85rem;
        border-radius: 50px;
        border: 1px solid rgb(140 96 13 / 0.3);
        margin-block: .3em;
      `,
      
      // ----- Teams Row -----
      ".mc-teams": `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-block: 0.5rem;
        position: relative;
      `,
      ".mc-team": `
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        flex: 1;
        text-align: center;
      `,
      ".mc-avatar": `
        width: 64px;
        height: 64px;
        border-radius: 50%;
        object-fit: cover;
        background: rgb(47 32 4); /* 900 */
        border: 2px solid rgb(140 96 13 / 0.4);
        padding: 4px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2);
      `,
      ".mc-team-name": `
        font-size: 1rem;
        font-weight: 600;
        color: rgb(253 245 232); /* 50 */
        line-height: 1.3;
      `,
      ".mc-vs-badge": `
        font-size: 0.75rem;
        font-weight: 800;
        color: rgb(187 127 17); /* 600 */
        background: rgb(33 22 3); /* 950 */
        padding: 0.45rem 0.65rem;
        border-radius: 50%;
        border: 1px solid rgb(93 64 9 / 0.6);
        z-index: 2;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      `,
      
      // ----- Footer / Action Zone -----
      ".mc-footer": `
        margin-top: 0.25rem;
      `,
      ".mc-probss-btn": `
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(90deg, rgb(233 159 22), rgb(238 178 68)); /* 500 to 400 */
        color: rgb(33 22 3); /* 950 text contrast */
        padding: 0.85rem 1.4rem;
        border-radius: 14px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 12px rgb(233 159 22 / 0.2);
      `,
      ".mc-probss-label": `
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.85;
      `,
      ".mc-probss-value": `
        font-size: 1.25rem;
        letter-spacing: -0.01em;
      `,
      
      // ----- Responsive Breakpoints -----
      "@media (max-width: 500px)": {
        ".mc-card": `
          padding: 1.35rem 1.15rem;
          border-radius: 20px;
          gap: 1.1rem;
        `,
        ".mc-avatar": `
          width: 52px;
          height: 52px;
        `,
        ".mc-team-name": `
          font-size: 0.9rem;
        `,
        ".mc-probss-btn": `
          padding: 0.75rem 1.15rem;
        `,
        ".mc-probss-value": `
          font-size: 1.1rem;
        `
      }
    },
    
    isReactive: true,
    id: "bcard-grid"
  }
}

export default Atom(BettingCard)