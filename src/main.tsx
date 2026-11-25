import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './ui/brand';
import './styles.css';

// The tab title until a plan takes over (the cook-along sets it to the plan and to live alerts).
document.title = APP_NAME;

const el = document.getElementById('root')!;
const root = createRoot(el);
const params = new URLSearchParams(location.search);

// `?mock=<scenario>` previews UI states without the real clock, storage or sound.
const load = params.has('mock') ? import('./ui/dev/MockApp').then((m) => m.MockApp) : import('./App').then((m) => m.default);

void load.then((Comp) =>
  root.render(
    <StrictMode>
      <Comp />
    </StrictMode>,
  ),
);
