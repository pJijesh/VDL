import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevent browser inspections and viewing source code
if (typeof window !== 'undefined') {
  // Disable right-click context menu
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  }, { capture: true });

  // Disable common developer keys, view-source, and inspect shortcuts
  document.addEventListener('keydown', (e) => {
    // 1. Disable F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Checking for Meta (Cmd on Mac) or Ctrl (Windows/Linux)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifier = isMac ? e.metaKey : e.ctrlKey;

    if (modifier) {
      // 2. Disable Ctrl+U / Cmd+U (View Source)
      if (e.key === 'u' || e.key === 'U' || e.code === 'KeyU') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // 3. Disable Ctrl+S / Cmd+S (Save Page)
      if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // 4. Disable developer shortcuts with Shift:
      // Ctrl+Shift+I / Cmd+Opt+I (Inspect Element)
      // Ctrl+Shift+J / Cmd+Opt+J (Console)
      // Ctrl+Shift+C / Cmd+Opt+C (Target Element Selector)
      if (e.shiftKey) {
        if (
          e.key === 'i' || e.key === 'I' || e.code === 'KeyI' ||
          e.key === 'j' || e.key === 'J' || e.code === 'KeyJ' ||
          e.key === 'c' || e.key === 'C' || e.code === 'KeyC'
        ) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    }
  }, { capture: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
