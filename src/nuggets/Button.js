import { Nugget } from 'queflow';

const Button = new Nugget("Button", {
  template: `
    <button onclick={{ click }} disabled={{ disabled }}>
      <span>{{ label }}</span>
      <span class="loader" q:show={{ isLoading }}></span>
    </button>
  `,
  
  stylesheet: {
    "button": `
      width: 80vw;
      height: 60px;
      position: fixed;
      bottom: 2rem;
      left: 10vw;
      color: #111;
      font-size: 1.1rem;
      font-weight: 600;
      background: #f0f0f0;
      border: 1px solid #333;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: 0.35s;
      box-shadow: none;
      letter-spacing: 0.02em;
      cursor: pointer;
    `,
    "button:hover": `
      background: #fff;
      color: #000;
    `,
    "button:disabled": `
      opacity: 0.6;
      cursor: not-allowed;
      background: #333;
      color: #999;
      border-color: #444;
    `,
    ".loader": `
      width: 18px;
      height: 18px;
      border: 2px solid rgba(0,0,0,0.2);
      border-top: 2px solid #000;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    `,
    "@keyframes spin": `
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    `
  }
});

export default Button;