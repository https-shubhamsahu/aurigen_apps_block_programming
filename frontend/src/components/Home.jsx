// ============================================================
// STACK LAYER: Frontend / Home Screen
// Hero banner · My Projects grid (cloud + local, unified) · New
// Project modal with a board picker · starter-example gallery.
// ============================================================
import { useEffect, useState } from 'react';
import { listProjects, loadProject, deleteProject, signOut } from '../lib/supabaseClient';
import { listLocalProjects, loadLocalProject, deleteLocalProject, isLocalId } from '../lib/localProjects';
import { useAuth } from '../auth/AuthProvider';
import { BOARDS, getBoard } from '../boards/boards';
import { EXAMPLES } from '../lib/examples';
import ArduinoUnoSVG from '../boards/ArduinoUnoSVG';
import Esp32DevkitSVG from '../boards/Esp32DevkitSVG';
import ModalShell from '../design/ModalShell';
import EmptyState from '../design/EmptyState';
import SkeletonCard from '../design/Skeleton';
import ThemeToggle from '../design/ThemeToggle';
import { color, space, radius, font, shadow, motion } from '../design/tokens';

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function BoardThumb({ boardId, width = 120 }) {
  const Svg = getBoard(boardId).short === 'uno' ? ArduinoUnoSVG : Esp32DevkitSVG;
  return (
    <div style={{ width, pointerEvents: 'none' }} aria-hidden="true">
      <Svg pins={{}} usage={{ buttonPins: new Set(), analogPins: new Set() }} buttons={{}} />
    </div>
  );
}

export default function Home({ onOpen }) {
  const { user, ready, openAuth } = useAuth();
  const [projects, setProjects] = useState(null); // null = loading
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('My Project');
  const [error, setError] = useState(null);

  async function refresh() {
    const local = listLocalProjects().map((p) => ({ ...p, _local: true }));
    if (!user) {
      setProjects(local);
      return;
    }
    try {
      const cloud = await listProjects();
      setProjects([...cloud, ...local]); // local remnants only exist if a migration retry is pending
    } catch (e) {
      setError(e.message);
      setProjects(local);
    }
  }
  useEffect(() => {
    if (!ready) return;
    refresh();
    // AuthProvider fires this after guest→account project migration.
    const h = () => refresh();
    window.addEventListener('aurigen:projects-changed', h);
    return () => window.removeEventListener('aurigen:projects-changed', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id]);

  async function open(id) {
    try {
      onOpen(isLocalId(id) ? loadLocalProject(id) : await loadProject(id));
    } catch (e) {
      setError(`Could not open project: ${e.message}`);
    }
  }

  async function remove(e, id, title) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      if (isLocalId(id)) deleteLocalProject(id);
      else await deleteProject(id);
      refresh();
    } catch (err) {
      setError(`Delete failed: ${err.message}`);
    }
  }

  function createProject(boardId) {
    setShowNew(false);
    onOpen({
      id: null,
      title: newName.trim() || 'My Project',
      board_target: boardId,
      workspace_xml: null,
    });
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <span style={S.brand}>Aurigen<span style={{ color: color.brand }}>.</span></span>
        <span className="aurigen-header-tagline" style={S.tagline}>ESP32 &amp; Arduino, straight from the browser</span>
        <div style={S.headerRight}>
          <ThemeToggle />
          {user ? (
            <>
              <span style={S.userChip} title={user.email}>{user.email}</span>
              <button style={S.signOut} onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            <button style={S.signIn} onClick={() => openAuth('generic')}>Sign in</button>
          )}
        </div>
      </header>

      {/* hero */}
      <div className="aurigen-hero" style={S.hero}>
        <div style={{ minWidth: 0 }}>
          <h1 style={S.heroTitle}>Code real boards.<br />No installs. No drivers*.</h1>
          <p style={S.heroSub}>
            Drag blocks, watch the C++, simulate on a photoreal board, then flash over USB.
            {!user && <strong> No sign-up needed — just start building.</strong>}
          </p>
          <div style={{ display: 'flex', gap: space.md, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              style={S.heroBtn}
              onClick={() => {
                const ex = EXAMPLES[0];
                onOpen({ id: null, title: ex.title, board_target: ex.board, workspace_xml: ex.xml });
              }}
            >
              <span aria-hidden="true">▶</span> Start with Blink
            </button>
            <button style={S.heroBtnGhost} onClick={() => setShowNew(true)}>
              <span aria-hidden="true">＋</span> New project
            </button>
          </div>
          <div style={S.heroFootnote}>*ok, sometimes one CH340 driver.</div>
        </div>
        <div className="aurigen-hero-boards" style={S.heroBoards}>
          <BoardThumb boardId="arduino_uno_r3" width={230} />
          <BoardThumb boardId="esp32_devkit_v1" width={120} />
        </div>
      </div>

      <main style={S.main}>
        {error && (
          <div style={S.errorBanner} role="alert">
            <span>{error}</span>
            <button style={S.errorDismiss} onClick={() => setError(null)} aria-label="Dismiss error">✕</button>
          </div>
        )}

        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' }}>
            <h2 style={S.h2}>My Projects</h2>
            {!user && projects?.length > 0 && (
              <button style={S.syncHint} onClick={() => openAuth('cloud')}>
                stored on this device — sign in to sync ↗
              </button>
            )}
          </div>
          <div style={S.grid}>
            <button style={S.newCard} onClick={() => setShowNew(true)}>
              <div style={S.plus} aria-hidden="true">＋</div>
              New Project
            </button>
            {projects === null && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
            {projects?.length === 0 && (
              <EmptyState
                icon="🗂️"
                title="No projects yet"
                hint="Start with an example below, or create a blank project to begin from scratch."
              />
            )}
            {projects?.map((p) => (
              <div key={p.id} style={S.card} className="aurigen-project-card" onClick={() => open(p.id)}
                   role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p.id); } }}>
                <div style={S.cardTop}>
                  <span style={S.cardTitle}>{p.title}</span>
                  <button style={S.delBtn} className="aurigen-delete-btn" title={`Delete "${p.title}"`}
                          aria-label={`Delete "${p.title}"`} onClick={(e) => remove(e, p.id, p.title)}>✕</button>
                </div>
                <span style={S.boardTag}>{getBoard(p.board_target).name}</span>
                <div style={{ display: 'flex', gap: space.sm, marginTop: 'auto', alignItems: 'center' }}>
                  {p._local && <span style={S.localTag} title="Saved in this browser only">this device</span>}
                  <span style={S.cardTime}>{timeAgo(p.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 style={S.h2}>Examples</h2>
          <div style={S.grid}>
            {EXAMPLES.map((ex) => (
              <div key={ex.id} style={S.exCard} className="aurigen-project-card"
                   onClick={() => onOpen({ id: null, title: ex.title, board_target: ex.board, workspace_xml: ex.xml })}
                   role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen({ id: null, title: ex.title, board_target: ex.board, workspace_xml: ex.xml }); } }}>
                <div style={S.exEmoji} aria-hidden="true">{ex.emoji}</div>
                <div style={S.cardTitle}>{ex.title}</div>
                <div style={S.exBlurb}>{ex.blurb}</div>
                <span style={S.boardTag}>{getBoard(ex.board).name}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* new-project modal: name + board picker */}
      {showNew && (
        <ModalShell onClose={() => setShowNew(false)} labelledBy="new-project-title" width={560}>
          <h3 id="new-project-title" style={S.modalTitle}>New project</h3>
          <label style={S.fieldLabel} htmlFor="new-project-name">Project name</label>
          <input
            id="new-project-name"
            style={S.nameInput}
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          <p style={S.pickBoardLabel}>Pick your board:</p>
          <div className="aurigen-board-modal-row" style={{ display: 'flex', gap: space.md }}>
            {Object.values(BOARDS).map((b) => (
              <button key={b.id} style={S.boardCard} onClick={() => createProject(b.id)}>
                <BoardThumb boardId={b.id} width={b.short === 'uno' ? 170 : 90} />
                <div style={{ fontWeight: 700, fontSize: font.sm, marginTop: space.sm }}>{b.name}</div>
                <div style={{ fontSize: font.xs, color: color.textMuted }}>{b.chip}</div>
              </button>
            ))}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: color.bg, color: color.text, fontFamily: font.family },
  header: {
    display: 'flex', alignItems: 'center', gap: space.lg, padding: `0 ${space.xxl}px`, height: 56,
    background: color.chromeBg, color: color.chromeText, flexWrap: 'wrap',
  },
  brand: { fontWeight: 800, fontSize: font.xl },
  tagline: { fontSize: font.xs, color: color.chromeTextMuted, flex: 1 },
  headerRight: { display: 'flex', alignItems: 'center', gap: space.md, marginLeft: 'auto' },
  signOut: {
    border: `1px solid ${color.chromeBorder}`, background: 'transparent', color: color.chromeTextMuted,
    borderRadius: radius.sm, padding: '6px 12px', fontSize: font.sm, cursor: 'pointer', transition: `background ${motion.fast}`,
  },
  signIn: { border: 'none', background: color.brand, color: color.brandInk, fontWeight: 700, borderRadius: radius.sm, padding: '7px 16px', fontSize: font.sm, cursor: 'pointer' },
  userChip: { fontSize: font.xs, color: color.chromeTextMuted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  syncHint: { border: 'none', background: 'transparent', color: color.brandTintInk, fontSize: font.sm, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3 },
  localTag: { fontSize: 9.5, background: color.surfaceSunken, color: color.textMuted, borderRadius: radius.pill, padding: '2px 7px', fontWeight: 600 },
  heroBtnGhost: {
    border: `2px solid ${color.brandInk}`, background: 'transparent', color: color.brandInk, fontWeight: 800,
    fontSize: font.md, borderRadius: radius.lg, padding: '11px 20px', cursor: 'pointer', transition: `transform ${motion.fast}`,
  },
  hero: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.xxl,
    padding: `${space.xxl}px 40px`, background: `linear-gradient(105deg, ${color.brand} 55%, #FFE45C)`,
  },
  heroTitle: { margin: 0, fontSize: font.display, lineHeight: 1.15, letterSpacing: '-0.02em', color: color.brandInk },
  heroSub: { fontSize: font.base, color: '#4A4000', maxWidth: 420, lineHeight: 1.5 },
  heroBtn: {
    border: 'none', background: color.brandInk, color: color.brand, fontWeight: 800, fontSize: font.md,
    borderRadius: radius.lg, padding: '13px 22px', cursor: 'pointer', transition: `transform ${motion.fast}`,
  },
  heroFootnote: { fontSize: font.xs, color: '#7A6A00', marginTop: space.sm },
  heroBoards: { display: 'flex', alignItems: 'center', gap: space.lg, flexShrink: 0 },
  main: { maxWidth: 1060, margin: '0 auto', padding: `${space.xxl + 2}px ${space.xl}px 60px`, display: 'flex', flexDirection: 'column', gap: 30 },
  h2: { fontSize: font.lg, margin: `0 0 ${space.md}px`, fontWeight: 700, letterSpacing: '-0.01em' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: space.lg },
  newCard: {
    display: 'grid', placeItems: 'center', gap: 4, minHeight: 120, borderRadius: radius.lg, border: 'none',
    background: color.brand, color: color.brandInk, fontWeight: 800, fontSize: font.base, cursor: 'pointer',
    boxShadow: shadow.brandBtn, fontFamily: 'inherit', transition: `transform ${motion.fast}`,
  },
  plus: { fontSize: 34, lineHeight: 1 },
  card: {
    display: 'flex', flexDirection: 'column', gap: space.sm, minHeight: 120, borderRadius: radius.lg,
    background: color.surface, padding: space.lg, cursor: 'pointer', border: `1px solid ${color.border}`,
    transition: `transform ${motion.fast}, box-shadow ${motion.fast}, border-color ${motion.fast}`,
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
  cardTitle: { fontWeight: 700, fontSize: font.base, color: color.text },
  delBtn: {
    border: 'none', background: 'transparent', color: color.textSecondary, cursor: 'pointer', fontSize: font.sm,
    width: 24, height: 24, borderRadius: radius.sm, flexShrink: 0, transition: `color ${motion.fast}, background ${motion.fast}`,
  },
  boardTag: {
    alignSelf: 'flex-start', fontSize: 10.5, background: color.brandTint, color: color.brandTintInk,
    borderRadius: radius.pill, padding: '3px 9px', fontWeight: 600,
  },
  cardTime: { fontSize: font.xs, color: color.textMuted, marginTop: 'auto' },
  exCard: {
    display: 'flex', flexDirection: 'column', gap: space.sm, borderRadius: radius.lg, background: color.surface,
    padding: space.lg, cursor: 'pointer', border: `1px solid ${color.border}`,
    transition: `transform ${motion.fast}, box-shadow ${motion.fast}, border-color ${motion.fast}`,
  },
  exEmoji: { fontSize: 26 },
  exBlurb: { fontSize: font.sm, color: color.textSecondary, lineHeight: 1.45 },
  errorBanner: {
    display: 'flex', alignItems: 'center', gap: space.md, padding: '10px 14px', background: color.warningBg,
    color: color.warningInk, borderRadius: radius.md, fontSize: font.sm,
  },
  errorDismiss: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', marginLeft: 'auto', fontSize: font.sm },
  modalTitle: { margin: '0 0 4px', fontSize: font.xl },
  fieldLabel: { display: 'block', fontSize: font.xs, fontWeight: 600, color: color.textMuted, marginTop: space.md },
  pickBoardLabel: { fontSize: font.sm, color: color.textSecondary, margin: `${space.lg}px 0 ${space.sm}px` },
  nameInput: {
    width: '100%', boxSizing: 'border-box', border: `2px solid ${color.border}`, borderRadius: radius.md,
    padding: '10px 12px', fontSize: font.base, background: color.surface, color: color.text, marginTop: 4,
  },
  boardCard: {
    flex: 1, border: `2px solid ${color.border}`, borderRadius: radius.lg, padding: space.md, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    background: 'transparent', color: color.text, fontFamily: 'inherit', transition: `border-color ${motion.fast}, transform ${motion.fast}`,
  },
};
