import { color, radius } from './tokens';

/** Shimmering placeholder card — used while project lists load. */
export default function SkeletonCard({ height = 120 }) {
  return (
    <div style={{ ...S.card, minHeight: height }} aria-hidden="true">
      <div style={S.shimmer} />
    </div>
  );
}

const S = {
  card: {
    position: 'relative', overflow: 'hidden', borderRadius: radius.lg,
    background: color.surfaceAlt, border: `1px solid ${color.border}`,
  },
  shimmer: {
    position: 'absolute', inset: 0,
    background: `linear-gradient(90deg, transparent, ${color.surfaceSunken}, transparent)`,
    animation: 'shimmer 1.4s ease-in-out infinite',
    transform: 'translateX(-100%)',
  },
};
