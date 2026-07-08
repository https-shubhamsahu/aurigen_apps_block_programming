// ============================================================
// STACK LAYER: Frontend / Design System — Theme Toggle
// Cycles explicit light -> dark -> system(auto). Persisted so the
// pre-paint script in index.html can apply it before first render.
// ============================================================
import { useEffect, useState } from 'react';
import { color } from './tokens';

function readStored() {
  try { return localStorage.getItem('aurigen.theme'); } catch { return null; }
}

export default function ThemeToggle({ style }) {
  const [mode, setMode] = useState(() => readStored() ?? 'system');

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
      try { localStorage.removeItem('aurigen.theme'); } catch { /* privacy mode */ }
    } else {
      root.setAttribute('data-theme', mode);
      try { localStorage.setItem('aurigen.theme', mode); } catch { /* privacy mode */ }
    }
  }, [mode]);

  function cycle() {
    setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system'));
  }

  const icon = mode === 'light' ? '☀️' : mode === 'dark' ? '🌙' : '🖥️';
  const label = mode === 'light' ? 'Light theme' : mode === 'dark' ? 'Dark theme' : 'Matching your system theme';

  return (
    <button
      onClick={cycle}
      title={`${label} — click to change`}
      aria-label={`Theme: ${label}. Click to switch.`}
      style={{
        width: 32, height: 32, display: 'grid', placeItems: 'center', fontSize: 15,
        border: `1px solid ${color.chromeBorder ?? 'var(--chrome-border)'}`, background: 'transparent',
        color: color.chromeText, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
        transition: 'background 120ms', ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
