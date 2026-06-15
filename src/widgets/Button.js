import { Widget } from 'valen';

const Button = new Widget("Button", {
  template: `
    <button @click=[ click ] disabled=[ disabled ]>
      <span>[ label ]</span>
      <span class="loader" q:show=[ disabled ]></span>
    </button>
  `,
  
  stylesheet: {
    "button": `
      width: 80vw;
      max-width: 450px; /* Perfectly aligns with your MatchCard width */
      height: 56px;
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%); /* Keeps it dead center */
      color: #09090b; /* Deep zinc/black for sharp text contrast */
      font-size: 1.2rem;
      font-weight: 600;
      background: #f4f4f5; /* Clean, premium light-zinc */
      border: 1px solid #e4e4e7;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: all 0.2s ease;
      /* Smooth, sophisticated ambient dark shadow instead of a colored glow */
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.7);
      letter-spacing: -0.01em;
      cursor: pointer;
      z-index: 100;
    `,
    "button:hover:not(:disabled)": `
      background: #ffffff; /* Subtle brightness increase on hover */
      transform: translate(-50%, -2px); /* Gentle lift */
      box-shadow: 0 15px 35px -10px rgba(0, 0, 0, 0.9);
    `,
    "button:disabled": `
      cursor: not-allowed;
      background: #27272a; /* Blends back into the dark theme components */
      color: #71717a;
      border: 1px solid #3f3f46;
      box-shadow: none;
      transform: translateX(-50%); /* Prevents it from jumping when disabled */
    `,
    ".loader": `
      width: 16px;
      height: 16px;
      border: 2px solid rgba(9, 9, 11, 0.2); /* Dark track to match dark text */
      border-top: 2px solid #09090b; /* Solid dark spinner tip */
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    `,
    "@keyframes spin": `
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    `
  }
});

export default Button;