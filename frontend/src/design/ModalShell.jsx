// ============================================================
// STACK LAYER: Frontend / Design System — Modal Shell
// The overlay + panel + Escape-to-close + focus-trap semantics
// that Home's "new project", the share dialog, and AuthModal
// each need. One implementation, one set of a11y guarantees:
//   * role="dialog" aria-modal, labelled by the caller's <h2/h3>
//   * Escape closes (unless dismissible=false, e.g. mid-recovery)
//   * click on the scrim closes; click inside the panel doesn't
//   * focus moves into the panel on open, returns to the trigger on close
//   * Tab/Shift+Tab wrap within the panel (no escaping to the page behind)
// ============================================================
import { useEffect, useRef } from 'react';
import { color, radius, shadow } from './tokens';

export default function ModalShell({ children, onClose, dismissible = true, labelledBy, width = 400 }) {
  const panelRef = useRef(null);
  const triggerRef = useRef(document.activeElement);

  useEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    const focusable = panel?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.[0]?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      trigger?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={S.overlay}
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ ...S.panel, width: `min(${width}px, 92vw)` }}
      >
        {children}
      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: color.overlay, backdropFilter: 'blur(3px)',
    display: 'grid', placeItems: 'center', zIndex: 250, padding: 16,
    animation: 'fadeIn 140ms ease',
  },
  panel: {
    position: 'relative', background: color.surface, color: color.text, borderRadius: radius.xl,
    padding: '28px 28px 22px', boxShadow: shadow.lg, animation: 'scaleIn 160ms cubic-bezier(0.2,0,0,1)',
    maxHeight: '90vh', overflowY: 'auto',
  },
};
