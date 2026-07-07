// ============================================================
// STACK LAYER: Frontend / Editor Shell (MakeCode-style layout)
//   header:  home · brand/board · Blocks/C++ tabs · share · sign out
//   left:    realistic board simulator + Download + name + save
//   right:   Blockly workspace (or C++ view) + undo/redo/zoom
// Board-aware: the toolbox, pin menus, codegen and the Download
// behavior all come from the project's board target.
//   * ESP32 → compile then flash over Web Serial (esptool-js)
//   * Uno   → compile then save the .hex (browser AVR flashing
//             is future work — STK500 protocol, not esptool)
// ============================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Blockly from 'blockly';
import '@blockly/toolbox-search'; // registers the 'search' toolbox category
import { cppGenerator } from '../blockly/cppGenerator';
import { buildToolbox, setActiveBoard } from '../blockly/esp32Blocks';
import { getAccessToken, saveProject, signOut } from '../lib/supabaseClient';
import { getBoard } from '../boards/boards';
import { encodeShare } from '../lib/share';
import { useWebSerial } from '../hooks/useWebSerial';
import Simulator from './Simulator';

const API = import.meta.env.VITE_COMPILE_API ?? 'http://localhost:4000';
const POLL_MS = 1500;

export default function BlocklyWorkspace({ project, onHome }) {
  const board = getBoard(project.board_target);
  const hostRef = useRef(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);

  // Dual state: XML for rendering/persistence, C++ for compilation.
  const [cpp, setCpp] = useState('');
  const [xml, setXml] = useState(project.workspace_xml ?? '');
  const [rev, setRev] = useState(0); // bumps on every edit — xml alone can round-trip unchanged
  const [tab, setTab] = useState('blocks'); // 'blocks' | 'cpp'
  const [title, setTitle] = useState(project.title ?? 'Untitled Project');
  const [projectId, setProjectId] = useState(project.id);
  const [saveState, setSaveState] = useState('idle'); // idle|saving|saved|error
  const [dirty, setDirty] = useState(false);
  const [simOpen, setSimOpen] = useState(true);
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [job, setJob] = useState({ phase: 'idle' }); // idle|queued|compiling|ready|error
  const { flash, flashState, progress, supported } = useWebSerial();

  // ---- Mount Blockly exactly once (component is keyed per project) ----
  useEffect(() => {
    setActiveBoard(board.id); // pin dropdowns read this at render time
    const workspace = Blockly.inject(hostRef.current, {
      toolbox: buildToolbox(board),
      renderer: 'zelos',            // rounded MakeCode-like renderer kids know
      grid: { spacing: 24, length: 2, colour: '#E4E4E4', snap: true },
      zoom: { controls: false, wheel: true, startScale: 0.9 },
      trashcan: true,
    });
    wsRef.current = workspace;

    if (import.meta.env.DEV) {
      // Test hooks for driving the editor from the console / e2e checks.
      window.__aurigenWs = workspace;
      window.__Blockly = Blockly;
    }

    if (project.workspace_xml) {
      try {
        Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(project.workspace_xml), workspace);
      } catch {
        console.warn('Saved workspace XML was invalid; starting empty.');
      }
    }

    // Regenerate both states on every meaningful edit (real-time C++ panel).
    const onChange = (event) => {
      if (event.isUiEvent) return; // ignore scroll/zoom/select noise
      const dom = Blockly.Xml.workspaceToDom(workspace);
      setXml(Blockly.Xml.domToText(dom));
      setRev((r) => r + 1);
      setDirty(true);
      try {
        setCpp(cppGenerator.workspaceToCode(workspace));
      } catch (e) {
        setCpp(`// generation error: ${e.message}`);
      }
    };
    workspace.addChangeListener(onChange);
    onChange({ isUiEvent: false });
    setDirty(false); // the initial render is not an edit

    return () => {
      clearInterval(pollRef.current);
      workspace.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blockly measures its container on inject; re-measure when the tab
  // switches back to blocks or the simulator panel collapses/expands.
  useEffect(() => {
    if (tab === 'blocks' && wsRef.current) Blockly.svgResize(wsRef.current);
  }, [tab, simOpen]);

  // ---- Autosave (saved projects only) + Ctrl/Cmd+S ----------------
  const saveRef = useRef(() => {});
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    // New projects need an explicit first save (that's what creates the row);
    // after that, edits flush automatically a few seconds after you stop.
    if (!dirty || !projectId) return;
    const t = setTimeout(() => saveRef.current(), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, xml, title, projectId]);

  // ---- Compile: POST → 202 + jobId → poll /status ----------------
  const compile = useCallback(async () => {
    setJob({ phase: 'queued' });
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Session expired — please sign in again.');

      const res = await fetch(`${API}/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cpp, board: board.short }),
      });
      if (res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Compile service returned ${res.status}`);
      }
      const { jobId } = await res.json();
      pollStatus(jobId, token);
    } catch (e) {
      setJob({ phase: 'error', message: e.message });
    }
  }, [cpp, board.short]);

  function pollStatus(jobId, token) {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/status/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();

        if (body.state === 'completed') {
          clearInterval(pollRef.current);
          setJob({ phase: 'ready', artifacts: body.artifacts });
        } else if (body.state === 'failed') {
          clearInterval(pollRef.current);
          // compilerOutput carries the arduino-cli stderr for the student.
          setJob({ phase: 'error', message: body.compilerOutput ?? 'Compilation failed.' });
        } else {
          setJob({ phase: 'compiling' });
        }
      } catch {
        clearInterval(pollRef.current);
        setJob({ phase: 'error', message: 'Lost contact with the compile service.' });
      }
    }, POLL_MS);
  }

  // ---- Deliver: esptool flash (ESP32) or .hex download (Uno) ------
  async function deliver() {
    if (board.flashMethod === 'hex') {
      const { url } = job.artifacts[0];
      const blob = await (await fetch(`${API}${url}`)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(title || 'sketch').replace(/[^\w-]+/g, '_')}.hex`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const files = await Promise.all(
      job.artifacts.map(async ({ offset, url }) => {
        const buf = await (await fetch(`${API}${url}`)).arrayBuffer();
        return { offset, data: buf };
      })
    );
    await flash(files);
  }

  async function save() {
    if (saveState === 'saving') return;
    setSaveState('saving');
    try {
      const row = await saveProject({
        id: projectId, title, workspaceXml: xml, generatedCpp: cpp, boardTarget: board.id,
      });
      setProjectId(row.id); // first save inserts; keep updating the same row after
      setDirty(false);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('error');
      alert(`Save failed: ${e.message}`);
    }
  }

  saveRef.current = save; // keep the shortcut/autosave pointing at fresh state

  function goHome() {
    if (dirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
    onHome();
  }

  const compiling = job.phase === 'queued' || job.phase === 'compiling';
  const flashing = flashState === 'flashing' || flashState === 'connecting';

  // One MakeCode-style button that walks the compile → deliver pipeline.
  const download = {
    label: compiling ? 'Compiling…'
      : flashing ? `Uploading ${progress}%`
      : job.phase === 'ready' ? (board.flashMethod === 'hex' ? '⬇ Save .hex file' : '⚡ Upload to board')
      : '⬇ Download',
    disabled: compiling || flashing || !cpp,
    onClick: job.phase === 'ready' ? deliver : compile,
  };

  const ws = () => wsRef.current;

  return (
    <div style={S.shell}>
      {/* ---- header ---- */}
      <header style={S.header}>
        <button style={S.homeBtn} title="Home" onClick={goHome}>⌂</button>
        <span style={S.brand}>Aurigen<span style={{ color: '#FFD400' }}>.</span></span>
        <span style={S.boardTag}>{board.name}</span>

        <div style={S.tabs}>
          {[['blocks', '🧩 Blocks'], ['cpp', '{ } C++']].map(([key, label]) => (
            <button key={key}
                    style={{ ...S.tab, ...(tab === key ? S.tabActive : {}) }}
                    onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        <button style={S.ghostBtn} onClick={() => { setShowShare(true); setCopied(false); }}>Share</button>
        <button style={S.ghostBtn} onClick={() => signOut()}>Sign out</button>
      </header>

      {!supported && board.flashMethod === 'esptool' && (
        <div style={S.banner}>
          This browser can't talk to USB devices — the simulator still works, but use Chrome or
          Edge on a desktop computer to upload to a real board.
        </div>
      )}

      <div style={S.main}>
        {/* ---- left: simulator + download dock (collapsible) ---- */}
        <aside style={{ ...S.side, ...(simOpen ? {} : S.sideClosed) }}>
          <Simulator wsRef={wsRef} rev={rev} board={board} />

          <div style={S.dock}>
            <button
              style={{ ...S.downloadBtn, opacity: download.disabled ? 0.55 : 1 }}
              disabled={download.disabled}
              onClick={download.onClick}
            >
              {download.label}
            </button>
            <div style={S.nameRow}>
              <input
                style={S.nameInput}
                value={title}
                onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                placeholder="Project name"
              />
              <button style={S.saveBtn} onClick={save} title="Save project">
                {saveState === 'saving' ? '…' : saveState === 'saved' ? '✓' : '💾'}
              </button>
            </div>
            {flashing && (
              <div style={S.progressTrack}>
                <div style={{ ...S.progressFill, width: `${progress}%` }} />
              </div>
            )}
          </div>
        </aside>

        {/* MakeCode-style collapse handle between the panels */}
        <button style={S.collapseHandle} onClick={() => setSimOpen(!simOpen)}
                title={simOpen ? 'Hide the simulator' : 'Show the simulator'}>
          {simOpen ? '‹' : '›'}
        </button>

        {/* ---- right: workspace / code view ---- */}
        <section style={S.stage}>
          <div ref={hostRef} style={{ ...S.blockly, display: tab === 'blocks' ? 'block' : 'none' }} />
          {tab === 'cpp' && (
            <pre style={S.codeView}>{cpp || '// your program will appear here'}</pre>
          )}

          {job.phase === 'error' && (
            <pre style={S.errorToast}>
              {job.message}
              <button style={S.toastClose} onClick={() => setJob({ phase: 'idle' })}>✕</button>
            </pre>
          )}

          {tab === 'blocks' && (
            <div style={S.floatControls}>
              <button style={S.roundBtn} title="Undo" onClick={() => ws()?.undo(false)}>↶</button>
              <button style={S.roundBtn} title="Redo" onClick={() => ws()?.undo(true)}>↷</button>
              <button style={S.roundBtn} title="Zoom in" onClick={() => ws()?.zoomCenter(1)}>＋</button>
              <button style={S.roundBtn} title="Zoom out" onClick={() => ws()?.zoomCenter(-1)}>－</button>
            </div>
          )}
        </section>
      </div>

      {/* ---- share dialog: the program travels inside the link ---- */}
      {showShare && (
        <div style={S.overlay} onClick={() => setShowShare(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px' }}>Share this project</h3>
            <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>
              The whole program is encoded in the link — nothing is uploaded.
              Anyone who opens it gets their own copy.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={S.shareInput} readOnly value={encodeShare(board.id, xml)}
                     onFocus={(e) => e.target.select()} />
              <button
                style={S.copyBtn}
                onClick={async () => {
                  await navigator.clipboard.writeText(encodeShare(board.id, xml));
                  setCopied(true);
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// App chrome stays yellow/white; the dark header mirrors MakeCode.
const S = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#FFF', fontFamily: "'Inter', system-ui, sans-serif" },
  header: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', height: 52,
    background: '#1A1A1A', color: '#FFF', flexShrink: 0,
  },
  homeBtn: {
    width: 34, height: 34, border: '1px solid #444', background: 'transparent', color: '#FFD400',
    borderRadius: 8, fontSize: 18, cursor: 'pointer', lineHeight: 1,
  },
  brand: { fontWeight: 800, fontSize: 19, letterSpacing: '-0.02em' },
  boardTag: { fontSize: 11, color: '#AAA', border: '1px solid #444', borderRadius: 999, padding: '3px 10px' },
  tabs: { display: 'flex', gap: 4, margin: '0 auto', background: '#2E2E2E', borderRadius: 10, padding: 3 },
  tab: {
    border: 'none', background: 'transparent', color: '#BBB', fontWeight: 600, fontSize: 13,
    padding: '7px 18px', borderRadius: 8, cursor: 'pointer',
  },
  tabActive: { background: '#FFD400', color: '#1A1A1A' },
  ghostBtn: {
    border: '1px solid #444', background: 'transparent', color: '#BBB', borderRadius: 8,
    padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  },
  banner: { padding: '8px 16px', background: '#FFF9DB', fontSize: 13, borderBottom: '1px solid #FFF3B0' },
  main: { flex: 1, display: 'flex', minHeight: 0 },
  side: {
    width: 330, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10,
    padding: 12, background: '#ECECEC', borderRight: '1px solid #DDD', minHeight: 0,
    overflow: 'hidden', transition: 'width 200ms ease, padding 200ms ease',
  },
  sideClosed: { width: 0, padding: '12px 0' },
  collapseHandle: {
    alignSelf: 'center', width: 18, height: 72, border: '1px solid #DDD', borderLeft: 'none',
    background: '#ECECEC', color: '#666', borderRadius: '0 10px 10px 0', cursor: 'pointer',
    fontSize: 15, padding: 0, flexShrink: 0, zIndex: 5,
  },
  dock: { display: 'flex', flexDirection: 'column', gap: 8 },
  downloadBtn: {
    border: 'none', borderRadius: 12, padding: '14px 0', background: '#FFD400', color: '#1A1A1A',
    fontWeight: 800, fontSize: 16, cursor: 'pointer', boxShadow: '0 2px 0 #D9B400',
  },
  nameRow: { display: 'flex', gap: 6 },
  nameInput: {
    flex: 1, border: '2px solid #DDD', borderRadius: 10, padding: '9px 12px', fontSize: 13,
    outlineColor: '#FFD400', background: '#FFF',
  },
  saveBtn: { width: 42, border: '2px solid #DDD', borderRadius: 10, background: '#FFF', cursor: 'pointer', fontSize: 14 },
  progressTrack: { height: 6, background: '#DDD', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#FFD400', transition: 'width 200ms' },
  stage: { flex: 1, position: 'relative', minWidth: 0 },
  blockly: { position: 'absolute', inset: 0 },
  codeView: {
    position: 'absolute', inset: 0, margin: 0, padding: 20, overflow: 'auto',
    background: '#FFFDF0', fontSize: 13.5, lineHeight: 1.6, fontFamily: "'Consolas', monospace",
  },
  errorToast: {
    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
    maxWidth: '80%', maxHeight: 160, overflow: 'auto', margin: 0, padding: '12px 36px 12px 14px',
    background: '#1A1A1A', color: '#FFD400', borderRadius: 10, fontSize: 12, whiteSpace: 'pre-wrap',
  },
  toastClose: {
    position: 'absolute', top: 6, right: 6, border: 'none', background: 'transparent',
    color: '#FFF', cursor: 'pointer', fontSize: 12,
  },
  floatControls: { position: 'absolute', right: 16, bottom: 16, display: 'flex', gap: 8, zIndex: 50 },
  roundBtn: {
    width: 40, height: 40, borderRadius: '50%', border: '1px solid #DDD', background: '#FFF',
    fontSize: 16, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid',
    placeItems: 'center', zIndex: 100,
  },
  modal: { background: '#FFF', borderRadius: 16, padding: 22, width: 'min(560px, 92vw)' },
  shareInput: {
    flex: 1, border: '2px solid #EEE', borderRadius: 10, padding: '9px 12px', fontSize: 12,
    fontFamily: 'monospace', color: '#555', outlineColor: '#FFD400',
  },
  copyBtn: {
    border: 'none', borderRadius: 10, background: '#FFD400', fontWeight: 700, padding: '0 16px',
    cursor: 'pointer',
  },
};
