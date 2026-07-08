// ============================================================
// STACK LAYER: Frontend / Design System
// Single source of truth for color, spacing, radius, type, and
// motion. Colors are CSS custom properties (defined + themed in
// global.css) so referencing `color.text` in an inline style
// object gets light/dark for free — no per-component branching.
// Everything else (spacing/radius/type/shadow) is a plain scale
// so every screen shares the same rhythm instead of inventing
// its own magic numbers.
// ============================================================

export const color = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  surfaceAlt: 'var(--surface-alt)',
  surfaceSunken: 'var(--surface-sunken)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',

  text: 'var(--text)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  textOnDark: 'var(--text-on-dark)',       // for chrome that's always dark (header, terminal)

  brand: 'var(--brand)',
  brandInk: 'var(--brand-ink)',            // text/icons sitting ON a yellow surface
  brandShadow: 'var(--brand-shadow)',      // the "3D button" drop under yellow CTAs
  brandTint: 'var(--brand-tint)',          // pale yellow chip background
  brandTintInk: 'var(--brand-tint-ink)',

  danger: 'var(--danger)',
  dangerBg: 'var(--danger-bg)',
  dangerInk: 'var(--danger-ink)',
  success: 'var(--success)',
  successBg: 'var(--success-bg)',
  successInk: 'var(--success-ink)',
  warning: 'var(--warning)',
  warningBg: 'var(--warning-bg)',
  warningInk: 'var(--warning-ink)',

  chromeBg: 'var(--chrome-bg)',            // header/footer bars — dark in both themes
  chromeBorder: 'var(--chrome-border)',
  chromeText: 'var(--chrome-text)',
  chromeTextMuted: 'var(--chrome-text-muted)',

  focusRing: 'var(--focus-ring)',
  overlay: 'var(--overlay)',
  terminalBg: 'var(--terminal-bg)',
  terminalText: 'var(--terminal-text)',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 };

export const radius = { sm: 8, md: 10, lg: 14, xl: 18, pill: 999 };

export const font = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', Consolas, 'Courier New', monospace",
  xs: 11, sm: 12.5, base: 14, md: 15, lg: 17, xl: 21, xxl: 26, display: 32,
};

export const shadow = {
  sm: '0 1px 3px var(--shadow-color-sm)',
  md: '0 4px 16px var(--shadow-color-md)',
  lg: '0 20px 60px var(--shadow-color-lg)',
  brandBtn: '0 2px 0 var(--brand-shadow)',   // the tactile MakeCode-style button lip
};

export const motion = {
  fast: '120ms cubic-bezier(0.2, 0, 0, 1)',
  base: '180ms cubic-bezier(0.2, 0, 0, 1)',
  slow: '280ms cubic-bezier(0.2, 0, 0, 1)',
};

/** Spread onto any interactive element for a visible, consistent focus ring. */
export const focusable = {
  outline: 'none', // replaced by :focus-visible in global.css via className="focusable"
};
