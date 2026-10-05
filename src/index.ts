import './index.css';

const name = 'Vite + Typescript';
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>Hello ${name}!</h1>
  <p>Your boilerplate is ready.</p>
`;

