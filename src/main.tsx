import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OverlingoController } from './app/controller';
import './styles.css';
import { App } from './ui/App';

const controller = new OverlingoController();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);
