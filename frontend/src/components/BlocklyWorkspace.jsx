// ============================================================
// STACK LAYER: Frontend / Editor Shell (MakeCode-style layout)
//   header:  home · brand/board · Blocks/C++ tabs · share · sign out
//   left:    realistic board simulator + Download + name + save
//   right:   Blockly workspace (or C++ view) + undo/redo/zoom
// Board-aware: the toolbox, pin menus, codegen and the Download
// behavior all come from the project's board target.
//   * ESP32 → compile then flash over Web Serial (esptool-js)
//   * Uno   → compile then flash over Web Serial (STK500v1 to
//             optiboot — see hooks/useAvrFlash), .hex fallback
// ============================================================
import { useEffect, useRef, useState, useCallback } from 'react';
import * as Blockly from 'blockly';
import '@blockly/toolbox-search'; // registers the 'search' toolbox category
import { cppGenerator } from '../blockly/cppGenerator';
import { buildToolbox, setActiveBoard } from '../blockly/esp32Blocks';
import { getAccessToken, saveProject, signOut } from '../lib/supabaseClient';
import { saveLocalProject, deleteLocalProject, isLocalId } from '../lib/localProjects';
import { useAuth } from '../auth/AuthProvider';
import { getBoard } from '../boards/boards';
import { encodeShare } from '../lib/share';
import { useWebSerial } from '../hooks/useWebSerial';
import { useAvrFlash } from '../hooks/useAvrFlash';
import Simulator from './Simulator';
import ModalShell from '../design/ModalShell';
import Spinner from '../design/Spinner';
import ThemeToggle from '../design/ThemeToggle';
import { color, space, radius, font, shadow, motion } from '../design/tokens';

const API = import.meta.env.VITE_COMPILE_API ?? 'http://localhost:4000';
const POLL_MS = 1500;

export default function BlocklyWorkspace({ project, onHome }) {
  const { user, requireAuth, openAuth } = useAuth();
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
  // Uno: the compiled .hex, kept in memory for the avr8js firmware
  // engine and the STK500 Web Serial flasher.
  const [firmware, setFirmware] = useState(null);
  const { flash, flashState, progress, supported } = useWebSerial();
  const { flashHex, avrFlashState, avrProgress, avrSupported } = useAvrFlash();

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
      // The program changed → any finished build no longer matches it.
      // Reset the pipeline so the button compiles fresh instead of
      // delivering stale firmware. (The cached hex stays for the sim,
      // flagged as stale there; error toasts stay until dismissed.)
      setJob((j) => (j.phase === 'ready' ? { phase: 'idle' } : j));
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

  }, [dirty, xml, title, projectId]);

  // ---- Compile: POST → 202 + jobId → poll /status ----------------
  // Guests can build and simulate freely; the cloud compiler is the one
  // feature that needs an account (it burns real server CPU). The modal
  // resumes the compile automatically after sign-in.
  const compile = useCallback(async () => {
    if (!requireAuth('compile', () => compileRef.current())) return;
    compileRevRef.current = revRef.current; // firmware ↔ program version tie
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

      // ---- Poll /status until the build settles -----------------
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const poll = await fetch(`${API}/api/status/${jobId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = await poll.json();

          if (body.state === 'completed') {
            clearInterval(pollRef.current);
            setJob({ phase: 'ready', artifacts: body.artifacts });
            if (board.short === 'uno') {
              // Cache the hex for the firmware simulator + USB flasher,
              // stamped with the program revision it was built from.
              fetch(`${API}${body.artifacts[0].url}`)
                .then((r) => r.text())
                .then((hex) => setFirmware({ hex, at: Date.now(), rev: compileRevRef.current }))
                .catch(() => {});
            }
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
    } catch (e) {
      setJob({ phase: 'error', message: e.message });
    }
  }, [cpp, board.short, requireAuth]);
  const compileRef = useRef(compile);
  compileRef.current = compile;
  const revRef = useRef(0);
  revRef.current = rev;
  const compileRevRef = useRef(0);

  // ---- Deliver: real USB programming for BOTH boards ---------------
  //  * ESP32 → esptool-js (four flash images)
  //  * Uno   → STK500v1 straight to optiboot (with .hex download as
  //            the fallback for browsers without Web Serial)
  async function getUnoHex() {
    if (firmware?.hex) return firmware.hex;
    const text = await (await fetch(`${API}${job.artifacts[0].url}`)).text();
    setFirmware({ hex: text, at: Date.now() });
    return text;
  }

  async function downloadHexFile() {
    const hex = await getUnoHex();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([hex], { type: 'text/plain' }));
    a.download = `${(title || 'sketch').replace(/[^\w-]+/g, '_')}.hex`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function deliver() {
    try {
      if (board.flashMethod === 'hex') {
        if (!avrSupported) return await downloadHexFile();
        try {
          await flashHex(await getUnoHex());
        } catch (e) {
          // Keep the artifacts so “save .hex instead” still works.
          setJob({ phase: 'error', message: `${e.message}`, artifacts: job.artifacts });
        }
        return;
      }
      const files = await Promise.all(
        job.artifacts.map(async ({ offset, url }) => {
          const res = await fetch(`${API}${url}`);
          if (!res.ok) throw new Error('expired');
          return { offset, data: await res.arrayBuffer() };
        })
      );
      await flash(files);
    } catch (e) {
      // Builds live ~10 minutes on the server; after that, recompile.
      const expired = e.message === 'expired' || /404|Failed to fetch/i.test(e.message);
      setJob({
        phase: 'error',
        message: expired
          ? 'That build has expired (builds are kept for 10 minutes). Hit Download to compile a fresh one.'
          : e.message,
      });
    }
  }

  async function save() {
    if (saveState === 'saving') return;
    setSaveState('saving');
    try {
      const payload = { id: projectId, title, workspaceXml: xml, generatedCpp: cpp, boardTarget: board.id };
      let row;
      if (!user) {
        // Guests save to this browser — zero friction, upgraded on sign-in.
        row = saveLocalProject(payload);
      } else if (isLocalId(projectId)) {
        // Signed in while holding a guest project: promote it to the cloud.
        row = await saveProject({ ...payload, id: null });
        deleteLocalProject(projectId);
      } else {
        row = await saveProject(payload);
      }
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
  const flashing = flashState === 'flashing' || flashState === 'connecting'
    || avrFlashState === 'flashing' || avrFlashState === 'connecting';
  const flashPct = board.flashMethod === 'hex' ? avrProgress : progress;

  // One MakeCode-style button that walks the compile → deliver pipeline.
  const download = {
    label: compiling ? 'Compiling…'
      : flashing ? `Uploading ${flashPct}%`
      : avrFlashState === 'done' ? '✓ Uploaded!'
      : job.phase === 'ready'
        ? (board.flashMethod === 'hex'
            ? (avrSupported ? '⚡ Upload via USB' : '⬇ Save .hex file')
            : '⚡ Upload to board')
      : '⬇ Download',
    disabled: compiling || flashing || !cpp,
    onClick: job.phase === 'ready' ? deliver : compile,
  };
  const busy = compiling || flashing;

  const ws = () => wsRef.current;

  return (
    <div style={S.shell}>
      {/* ---- header ---- */}
      <header className="aurigen-editor-header" style={S.header}>
        <button style={S.homeBtn} title="Home" aria-label="Back to home" onClick={goHome}>⌂</button>
        <span className="aurigen-editor-brand" style={S.brand}>Aurigen<span style={{ color: color.brand }}>.</span></span>
        <span className="aurigen-editor-boardtag" style={S.boardTag}>{board.name}</span>

        <div style={S.tabs} role="tablist" aria-label="View">
          {[['blocks', '🧩 Blocks'], ['cpp', '{ } C++']].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className="aurigen-tab-btn"
                    style={{ ...S.tab, ...(tab === key ? S.tabActive : {}) }}
                    onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        <ThemeToggle style={{ borderColor: color.chromeBorder }} />
        <button style={S.ghostBtn} onClick={() => { setShowShare(true); setCopied(false); }}>Share</button>
        {user ? (
          <button style={S.ghostBtn} onClick={() => signOut()}>Sign out</button>
        ) : (
          <button style={S.signInBtn} onClick={() => openAuth('generic')}>Sign in</button>
        )}
      </header>

      {!supported && board.flashMethod === 'esptool' && (
        <div style={S.banner} role="status">
          <span aria-hidden="true">ℹ️</span> This browser can't talk to USB devices — the simulator still
          works, but use Chrome or Edge on a desktop computer to upload to a real board.
        </div>
      )}

      <div className="aurigen-editor-main" style={S.main}>
        {/* ---- left: simulator + download dock (collapsible) ---- */}
        <aside className={`aurigen-editor-side${simOpen ? '' : ' is-closed'}`}
               style={{ ...S.side, ...(simOpen ? {} : S.sideClosed) }}>
          <Simulator wsRef={wsRef} rev={rev} board={board} firmware={firmware}
                     firmwareStale={firmware != null && rev > firmware.rev} />

          <div style={S.dock}>
            <button
              style={{ ...S.downloadBtn, ...(download.disabled ? S.downloadBtnDisabled : {}) }}
              disabled={download.disabled}
              onClick={download.onClick}
            >
              {busy && <Spinner size={16} />}
              {download.label}
            </button>
            <div style={S.nameRow}>
              <label htmlFor="project-name-input" style={S.srOnly}>Project name</label>
              <input
                id="project-name-input"
                style={S.nameInput}
                value={title}
                onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                placeholder="Project name"
              />
              <button style={S.saveBtn} onClick={save} title="Save project" aria-label="Save project">
                {saveState === 'saving' ? <Spinner size={14} /> : saveState === 'saved' ? '✓' : '💾'}
              </button>
            </div>
            {flashing && (
              <div style={S.progressTrack} role="progressbar" aria-valuenow={flashPct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ ...S.progressFill, width: `${flashPct}%` }} />
              </div>
            )}
            {board.flashMethod === 'hex' && job.phase === 'ready' && avrSupported && !flashing && (
              <button style={S.hexLink} onClick={downloadHexFile}>…or save the .hex file instead</button>
            )}
          </div>
        </aside>

        {/* MakeCode-style collapse handle between the panels */}
        <button className="aurigen-collapse-handle" style={S.collapseHandle} onClick={() => setSimOpen(!simOpen)}
                title={simOpen ? 'Hide the simulator' : 'Show the simulator'}
                aria-label={simOpen ? 'Hide the simulator' : 'Show the simulator'} aria-expanded={simOpen}>
          {simOpen ? '‹' : '›'}
        </button>

        {/* ---- right: workspace / code view ---- */}
        <section style={S.stage}>
          <div ref={hostRef} style={{ ...S.blockly, display: tab === 'blocks' ? 'block' : 'none' }} />
          {tab === 'cpp' && (
            <pre style={S.codeView}>{cpp || '// your program will appear here'}</pre>
          )}

          {job.phase === 'error' && (
            <div style={S.errorToast} role="alert">
              <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
              <pre style={S.errorText}>{job.message}</pre>
              <button style={S.toastClose} onClick={() => setJob({ phase: 'idle' })} aria-label="Dismiss error">✕</button>
            </div>
          )}

          {tab === 'blocks' && (
            <div style={S.floatControls}>
              <button style={S.roundBtn} title="Undo" aria-label="Undo" onClick={() => ws()?.undo(false)}>↶</button>
              <button style={S.roundBtn} title="Redo" aria-label="Redo" onClick={() => ws()?.undo(true)}>↷</button>
              <button style={S.roundBtn} title="Zoom in" aria-label="Zoom in" onClick={() => ws()?.zoomCenter(1)}>＋</button>
              <button style={S.roundBtn} title="Zoom out" aria-label="Zoom out" onClick={() => ws()?.zoomCenter(-1)}>－</button>
            </div>
          )}
        </section>
      </div>

      {/* ---- share dialog: the program travels inside the link ---- */}
      {showShare && (
        <ModalShell onClose={() => setShowShare(false)} labelledBy="share-title" width={560}>
          <h3 id="share-title" style={S.modalTitle}>Share this project</h3>
          <p style={S.modalBody}>
            The whole program is encoded in the link — nothing is uploaded.
            Anyone who opens it gets their own copy.
          </p>
          <div style={{ display: 'flex', gap: space.sm }}>
            <label htmlFor="share-link-input" style={S.srOnly}>Share link</label>
            <input id="share-link-input" style={S.shareInput} readOnly value={encodeShare(board.id, xml)}
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
        </ModalShell>
      )}
    </div>
  );
}

// App chrome stays yellow/white; the dark header mirrors MakeCode.
const S = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh', background: color.surface, color: color.text, fontFamily: font.family },
  header: {
    display: 'flex', alignItems: 'center', gap: space.md, padding: `0 ${space.lg}px`, height: 52,
    background: color.chromeBg, color: color.chromeText, flexShrink: 0,
  },
  homeBtn: {
    width: 34, height: 34, border: `1px solid ${color.chromeBorder}`, background: 'transparent', color: color.brand,
    borderRadius: radius.sm, fontSize: font.lg, cursor: 'pointer', lineHeight: 1,
  },
  brand: { fontWeight: 800, fontSize: font.xl, letterSpacing: '-0.02em' },
  boardTag: { fontSize: font.xs, color: color.chromeTextMuted, border: `1px solid ${color.chromeBorder}`, borderRadius: radius.pill, padding: '3px 10px' },
  tabs: { display: 'flex', gap: 4, margin: '0 auto', background: '#2E2E32', borderRadius: radius.md, padding: 3 },
  tab: {
    border: 'none', background: 'transparent', color: color.chromeTextMuted, fontWeight: 600, fontSize: font.sm,
    padding: '7px 18px', borderRadius: radius.sm, cursor: 'pointer',
  },
  tabActive: { background: color.brand, color: color.brandInk },
  ghostBtn: {
    border: `1px solid ${color.chromeBorder}`, background: 'transparent', color: color.chromeTextMuted, borderRadius: radius.sm,
    padding: '6px 12px', fontSize: font.sm, cursor: 'pointer',
  },
  signInBtn: {
    border: 'none', background: color.brand, color: color.brandInk, fontWeight: 700, borderRadius: radius.sm,
    padding: '7px 16px', fontSize: font.sm, cursor: 'pointer',
  },
  banner: {
    display: 'flex', alignItems: 'center', gap: space.sm, padding: '8px 16px', background: color.warningBg,
    color: color.warningInk, fontSize: font.sm, borderBottom: `1px solid ${color.border}`,
  },
  main: { flex: 1, display: 'flex', minHeight: 0 },
  side: {
    width: 330, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: space.sm,
    padding: space.md, background: color.surfaceAlt, borderRight: `1px solid ${color.border}`, minHeight: 0,
    overflow: 'hidden', transition: `width ${motion.base}, padding ${motion.base}`,
  },
  sideClosed: { width: 0, padding: `${space.md}px 0` },
  collapseHandle: {
    alignSelf: 'center', width: 18, height: 72, border: `1px solid ${color.border}`, borderLeft: 'none',
    background: color.surfaceAlt, color: color.textSecondary, borderRadius: `0 ${radius.md}px ${radius.md}px 0`, cursor: 'pointer',
    fontSize: font.md, padding: 0, flexShrink: 0, zIndex: 5,
  },
  dock: { display: 'flex', flexDirection: 'column', gap: space.sm },
  downloadBtn: {
    border: 'none', borderRadius: radius.lg, padding: '14px 0', background: color.brand, color: color.brandInk,
    fontWeight: 800, fontSize: font.md, cursor: 'pointer', boxShadow: shadow.brandBtn,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  downloadBtnDisabled: { opacity: 0.55, boxShadow: 'none' },
  nameRow: { display: 'flex', gap: space.xs },
  nameInput: {
    flex: 1, border: `2px solid ${color.border}`, borderRadius: radius.md, padding: '9px 12px', fontSize: font.sm,
    background: color.surface, color: color.text,
  },
  saveBtn: {
    width: 42, border: `2px solid ${color.border}`, borderRadius: radius.md, background: color.surface,
    cursor: 'pointer', fontSize: font.base, display: 'grid', placeItems: 'center', color: color.text,
  },
  hexLink: { border: 'none', background: 'transparent', color: color.brandTintInk, fontSize: font.xs, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 },
  progressTrack: { height: 6, background: color.surfaceSunken, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: color.brand, transition: 'width 200ms' },
  stage: { flex: 1, position: 'relative', minWidth: 0 },
  blockly: { position: 'absolute', inset: 0 },
  codeView: {
    position: 'absolute', inset: 0, margin: 0, padding: space.xxl, overflow: 'auto',
    background: color.surfaceAlt, color: color.text, fontSize: 13.5, lineHeight: 1.6, fontFamily: font.mono,
  },
  errorToast: {
    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
    maxWidth: '80%', maxHeight: 200, overflow: 'auto', display: 'flex', gap: space.sm, alignItems: 'flex-start',
    padding: '12px 36px 12px 14px', background: color.chromeBg, color: color.brand, borderRadius: radius.md,
    fontSize: font.sm, boxShadow: shadow.lg, animation: 'slideUp 180ms cubic-bezier(0.2,0,0,1)',
  },
  errorText: { margin: 0, whiteSpace: 'pre-wrap', fontFamily: font.mono, fontSize: font.xs },
  toastClose: {
    position: 'absolute', top: 8, right: 8, border: 'none', background: 'transparent',
    color: color.chromeTextMuted, cursor: 'pointer', fontSize: font.sm, width: 22, height: 22, borderRadius: radius.sm,
  },
  floatControls: { position: 'absolute', right: 16, bottom: 16, display: 'flex', gap: space.sm, zIndex: 50 },
  roundBtn: {
    width: 40, height: 40, borderRadius: '50%', border: `1px solid ${color.border}`, background: color.surface,
    color: color.text, fontSize: font.md, cursor: 'pointer', boxShadow: shadow.sm,
  },
  modalTitle: { margin: '0 0 6px', fontSize: font.xl, color: color.text },
  modalBody: { fontSize: font.sm, color: color.textSecondary, margin: `0 0 ${space.md}px`, lineHeight: 1.5 },
  shareInput: {
    flex: 1, border: `2px solid ${color.border}`, borderRadius: radius.md, padding: '9px 12px', fontSize: font.xs,
    fontFamily: font.mono, color: color.textSecondary, background: color.surfaceAlt,
  },
  copyBtn: {
    border: 'none', borderRadius: radius.md, background: color.brand, color: color.brandInk, fontWeight: 700, padding: '0 16px',
    cursor: 'pointer',
  },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
    clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
  },
};
