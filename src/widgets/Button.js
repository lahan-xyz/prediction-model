import { Widget } from 'valen';
import Text from './Text.js';

function Button() {
  return {
    template() {
      return `
        <button @click=[ click ] disabled=[ disabled ]>
          <span class="btn-text">
            <Text {
              txt: "[ label ]",
              color: "inherit"
            } />
          </span>
          <span class="loader" v:show=[ disabled ]></span>
        </button>
      `;
    },
    stylesheet: {
      "button": `
        width: 80vw;
        max-width: 450px;
        height: 56px;
        position: fixed;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        padding: 0 1.5rem;
        
        color: rgb(33 22 3); /* Deep amber/black 950 */
        font-size: 1.1rem;
        font-weight: 700;
        background: linear-gradient(180deg, rgb(246 217 162), rgb(212 143 14)); /* Sleek, metallic warm gold */
        border: 1px solid rgb(253 245 232 / 0.25);
        border-radius: 14px;
        
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, background 0.2s ease;
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.8), 0 4px 14px rgb(212 143 14 / 0.2);
        letter-spacing: -0.01em;
        cursor: pointer;
        z-index: 100;
      `,
      "button:hover:not(:disabled)": `
        background: linear-gradient(180deg, rgb(253 245 232), rgb(225 156 18)); /* Lighter reflection on hover */
        transform: translate(-50%, -3px);
        box-shadow: 0 15px 35px -10px rgba(0, 0, 0, 0.9), 0 6px 20px rgb(212 143 14 / 0.35);
      `,
      "button:active:not(:disabled)": `
        transform: translate(-50%, 1px);
        box-shadow: 0 4px 10px -5px rgba(0, 0, 0, 0.8);
      `,
      "button:disabled": `
        cursor: not-allowed;
        background: rgb(54 37 5); /* Solid dark amber-chocolate */
        background-image: none;
        color: rgb(242 198 115 / 0.4);
        border: 1px solid rgb(93 64 9 / 0.4);
        box-shadow: none;
        transform: translateX(-50%);
      `,
      ".btn-text": `
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      `,
      ".loader": `
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        border: 2px solid rgb(242 198 115 / 0.15);
        border-top: 2px solid rgb(242 198 115 / 0.9);
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      `,
      "@keyframes spin": `
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      `
    }
  };
}

export default Widget(Button);