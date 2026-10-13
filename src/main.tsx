import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OverlingoController } from './app/controller';
import './styles.css';
import { App } from './ui/App';

const controller = new OverlingoController();
// Lets the dev tools console (and browser automation) inspect state. Stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { overlingo: controller });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);
