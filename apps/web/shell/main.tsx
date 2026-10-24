// The app entry: the candidate's stylesheet (style.scss, which carries product-ux.scss) and the shell, mounted
// where classic mounted its app (`elmish-app`).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/style.scss';
import { Shell } from './Shell.tsx';

const root = document.getElementById('elmish-app');
if (!root) throw new Error('No #elmish-app element to mount the app into');
createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
