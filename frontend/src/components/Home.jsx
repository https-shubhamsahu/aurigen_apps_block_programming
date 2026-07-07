// ============================================================
// STACK LAYER: Frontend / Home Screen (MakeCode-style)
// Hero banner · My Projects grid (Supabase-backed: open, delete,
// relative timestamps) · New Project modal with a board picker ·
// starter-example gallery per board.
// ============================================================
import { useEffect, useState } from 'react';
import { listProjects, loadProject, deleteProject, signOut } from '../lib/supabaseClient';
import { listLocalProjects, loadLocalProject, deleteLocalProject, isLocalId } from '../lib/localProjects';
import { useAuth } from '../auth/AuthProvider';
import { BOARDS, getBoard } from '../boards/boards';
import { EXAMPLES } from '../lib/examples';
import ArduinoUnoSVG from '../boards/ArduinoUnoSVG';
import Esp32DevkitSVG from '../boards/Esp32DevkitSVG';

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
    <div style={{ width, pointerEvents: 'none' }}>
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
        <span style={S.brand}>Aurigen<span style={{ color: '#FFD400' }}>.</span></span>
        <span style={S.tagline}>ESP32 &amp; Arduino, straight from the browser</span>
        {user ? (
          <>
            <span style={S.userChip} title={user.email}>{user.email}</span>
            <button style={S.signOut} onClick={() => signOut()}>Sign out</button>
          </>
        ) : (
          <button style={S.signIn} onClick={() => openAuth('generic')}>Sign in</button>
        )}
      </header>

      {/* hero */}
      <div style={S.hero}>
        <div>
          <h1 style={S.heroTitle}>Code real boards.<br />No installs. No drivers*.</h1>
          <p style={S.heroSub}>
            Drag blocks, watch the C++, simulate on a photoreal board, then flash over USB.
            {!user && <strong> No sign-up needed — just start building.</strong>}
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              style={S.heroBtn}
              onClick={() => {
                const ex = EXAMPLES[0];
                onOpen({ id: null, title: ex.title, board_target: ex.board, workspace_xml: ex.xml });
              }}
            >
              ▶ Start with Blink
            </button>
            <button style={S.heroBtnGhost} onClick={() => setShowNew(true)}>
              ＋ New project
            </button>
          </div>
          <div style={S.heroFootnote}>*ok, sometimes one CH340 driver.</div>
        </div>
        <div style={S.heroBoards}>
          <BoardThumb boardId="arduino_uno_r3" width={230} />
          <BoardThumb boardId="esp32_devkit_v1" width={120} />
        </div>
      </div>

      <main style={S.main}>
        {error && <div style={S.error}>{error}</div>}

        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h2 style={S.h2}>My Projects</h2>
            {!user && projects?.length > 0 && (
              <button style={S.syncHint} onClick={() => openAuth('cloud')}>
                stored on this device — sign in to sync ↗
              </button>
            )}
          </div>
          <div style={S.grid}>
            <div style={S.newCard} onClick={() => setShowNew(true)}>
              <div style={S.plus}>＋</div>
              New Project
            </div>
            {projects === null && <div style={S.loading}>Loading…</div>}
            {projects?.map((p) => (
              <div key={p.id} style={S.card} onClick={() => open(p.id)}>
                <div style={S.cardTop}>
                  <span style={S.cardTitle}>{p.title}</span>
                  <button style={S.delBtn} title="Delete" onClick={(e) => remove(e, p.id, p.title)}>✕</button>
                </div>
                <span style={S.boardTag}>{getBoard(p.board_target).name}</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto', alignItems: 'center' }}>
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
              <div key={ex.id} style={S.exCard}
                   onClick={() => onOpen({ id: null, title: ex.title, board_target: ex.board, workspace_xml: ex.xml })}>
                <div style={S.exEmoji}>{ex.emoji}</div>
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
        <div style={S.overlay} onClick={() => setShowNew(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px' }}>New project</h3>
            <input
              style={S.nameInput}
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
            <p style={{ fontSize: 13, color: '#666', margin: '14px 0 8px' }}>Pick your board:</p>
            <div style={{ display: 'flex', gap: 12 }}>
              {Object.values(BOARDS).map((b) => (
                <div key={b.id} style={S.boardCard} onClick={() => createProject(b.id)}>
                  <BoardThumb boardId={b.id} width={b.short === 'uno' ? 170 : 90} />
                  <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{b.chip}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#F5F5F5', fontFamily: "'Inter', system-ui, sans-serif" },
  header: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', height: 52,
    background: '#1A1A1A', color: '#FFF',
  },
  brand: { fontWeight: 800, fontSize: 19 },
  tagline: { fontSize: 12, color: '#AAA', flex: 1 },
  signOut: { border: '1px solid #444', background: 'transparent', color: '#BBB', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  signIn: { border: 'none', background: '#FFD400', color: '#1A1A1A', fontWeight: 700, borderRadius: 8, padding: '7px 16px', fontSize: 12.5, cursor: 'pointer' },
  userChip: { fontSize: 11.5, color: '#888', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  syncHint: { border: 'none', background: 'transparent', color: '#8A6D00', fontSize: 12, cursor: 'pointer', padding: 0 },
  localTag: { fontSize: 9.5, background: '#EEE', color: '#777', borderRadius: 999, padding: '2px 7px', fontWeight: 600 },
  heroBtnGhost: {
    border: '2px solid #1A1A1A', background: 'transparent', color: '#1A1A1A', fontWeight: 800,
    fontSize: 15, borderRadius: 12, padding: '11px 20px', cursor: 'pointer',
  },
  hero: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
    padding: '34px 40px', background: 'linear-gradient(105deg, #FFD400 55%, #FFE45C)',
  },
  heroTitle: { margin: 0, fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#1A1A1A' },
  heroSub: { fontSize: 14, color: '#4A4000', maxWidth: 420 },
  heroBtn: {
    border: 'none', background: '#1A1A1A', color: '#FFD400', fontWeight: 800, fontSize: 15,
    borderRadius: 12, padding: '13px 22px', cursor: 'pointer',
  },
  heroFootnote: { fontSize: 10, color: '#7A6A00', marginTop: 8 },
  heroBoards: { display: 'flex', alignItems: 'center', gap: 14 },
  main: { maxWidth: 1060, margin: '0 auto', padding: '26px 20px 60px', display: 'flex', flexDirection: 'column', gap: 30 },
  h2: { fontSize: 18, margin: '0 0 12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 },
  newCard: {
    display: 'grid', placeItems: 'center', gap: 4, minHeight: 120, borderRadius: 14,
    background: '#FFD400', fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 0 #D9B400',
  },
  plus: { fontSize: 34, lineHeight: 1 },
  card: {
    display: 'flex', flexDirection: 'column', gap: 6, minHeight: 120, borderRadius: 14,
    background: '#FFF', padding: 14, cursor: 'pointer', border: '1px solid #E4E4E4',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  cardTitle: { fontWeight: 700, fontSize: 14 },
  delBtn: { border: 'none', background: 'transparent', color: '#BBB', cursor: 'pointer', fontSize: 13 },
  boardTag: {
    alignSelf: 'flex-start', fontSize: 10.5, background: '#FFF4C2', color: '#7A6A00',
    borderRadius: 999, padding: '3px 9px', fontWeight: 600,
  },
  cardTime: { fontSize: 11.5, color: '#999', marginTop: 'auto' },
  exCard: {
    display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 14, background: '#FFF',
    padding: 14, cursor: 'pointer', border: '1px solid #E4E4E4',
  },
  exEmoji: { fontSize: 26 },
  exBlurb: { fontSize: 12, color: '#777', lineHeight: 1.45 },
  loading: { display: 'grid', placeItems: 'center', color: '#999', fontSize: 13, minHeight: 120 },
  error: { padding: '10px 14px', background: '#FFF9DB', borderRadius: 10, fontSize: 13 },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid',
    placeItems: 'center', zIndex: 100,
  },
  modal: { background: '#FFF', borderRadius: 16, padding: 24, width: 'min(560px, 92vw)' },
  nameInput: {
    width: '100%', boxSizing: 'border-box', border: '2px solid #EEE', borderRadius: 10,
    padding: '10px 12px', fontSize: 14, outlineColor: '#FFD400', marginTop: 8,
  },
  boardCard: {
    flex: 1, border: '2px solid #EEE', borderRadius: 14, padding: 12, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
  },
};
