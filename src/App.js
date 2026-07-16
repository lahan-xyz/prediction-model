import { App } from 'valen';
import Main from './components/Main.js';

const View = new App("#app", {
  template: () => `
    <Main/>
  `,
  stylesheet: {
    "*": `
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    `,
    "body": `
      background: rgb(33 22 3); /* 950 - Darkest background in the palette */
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      padding: 2rem 1rem;
      color: rgb(253 245 232); /* 50 - Matching the exact home team name color */
      line-height: 1.6;
      min-height: 100vh;
      letter-spacing: -0.01em;
    `,
    "h1": `
      font-size: 2.2rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      letter-spacing: -0.02em;
      color: rgb(253 245 232); /* 50 */
    `,
    /* Optional: remove all link/button tap highlights on mobile */
    "a, button": `
      -webkit-tap-highlight-color: transparent;
    `,
    "@font-face": `
      font-family: 'Inter';
      font-style: normal;
      font-weight: normal;
      font-display: swap;
      src: url('./src/assets/Inter-Bold.otf');
    `
  }
});

View.render();