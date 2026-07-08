import { color, font } from './tokens';

/** A considered "nothing here yet" state — icon, message, and an optional CTA. */
export default function EmptyState({ icon, title, hint, action }) {
  return (
    <div style={S.wrap} role="status">
      <div style={S.icon} aria-hidden="true">{icon}</div>
      <div style={S.title}>{title}</div>
      {hint && <div style={S.hint}>{hint}</div>}
      {action}
    </div>
  );
}

const S = {
  wrap: {
    gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 6, padding: '38px 20px', textAlign: 'center', color: color.textMuted,
  },
  icon: { fontSize: 32, marginBottom: 4, opacity: 0.8 },
  title: { fontSize: font.base, fontWeight: 600, color: color.textSecondary },
  hint: { fontSize: font.sm, maxWidth: 320, lineHeight: 1.5 },
};
