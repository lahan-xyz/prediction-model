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
      font-family: 'Bricolage Grotesque';
    `,
    "body": `
      background: #0a0a0a;
      font-family: 'Bricolage Grotesque';
      padding: 2rem 1rem;
      color: #f0f0f0;
      line-height: 1.6;
      min-height: 100vh;
      letter-spacing: -0.01em;
    `,
    "h1": `
      font-size: 2.2rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      letter-spacing: -0.02em;
      color: #ffffff;
      /* simple white heading, no gradient needed */
    `,
    /* Optional: remove all link/button tap highlights on mobile */
    "a, button": `
      -webkit-tap-highlight-color: transparent;
    `,
    "@font-face": `
    font-family: 'Bricolage Grotesque';
    font-style: normal;
    font-weight: 200 800;
    font-stretch: 100%;
    font-display: swap;
    src: url('./src/assets/brico.woff2');
   `
  }
});

View.render();