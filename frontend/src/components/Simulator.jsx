// ============================================================
// STACK LAYER: Frontend / Simulator UI
// MakeCode-style panel around the realistic board renders, now
// with the full simulator toolbar and live instrumentation:
//   * 3D tilt that follows the mouse (direct DOM transform —
//     no React re-render per mousemove)
//   * Run/Stop · restart · slow-mo · board screenshot (PNG) ·
//     fullscreen board view (Esc closes)
//   * Serial MONITOR ⇄ PLOT tabs — the plotter charts numeric
//     serial prints live (single series: brand line on dark
//     surface, recessive grid, values in text ink, hover readout)
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { SimRunner, analyzeUsage } from '../simulator/interpreter';
import ArduinoUnoSVG from '../boards/ArduinoUnoSVG';
import Esp32DevkitSVG from '../boards/Esp32DevkitSVG';

const PLOT_POINTS = 240;

export default function Simulator({ wsRef, rev, board }) {
  const runnerRef = useRef(null);
  const serialEndRef = useRef(null);
  const boardWrapRef = useRef(null);
  const tiltRef = useRef(null);
  const [sim, setSim] = useState({ pins: {}, serial: [], wifi: 'off', running: false, txCount: 0 });
  const [slowMo, setSlowMo] = useState(false);
  const [txFlash, setTxFlash] = useState(false);
  const [fs, setFs] = useState(false);            // fullscreen board view
  const [serialTab, setSerialTab] = useState('monitor'); // 'monitor' | 'plot'
  const [plotHover, setPlotHover] = useState(null);      // hovered sample index
  // UI copies of the inputs so pads/sliders render before Run is pressed.
  const [buttons, setButtons] = useState({}); // pin -> pressed?
  const [sliders, setSliders] = useState({}); // pin -> 0..adcMax

  // Which widgets to draw comes from a static scan of the program.
  // Keyed on the edit revision, not the XML text: a freshly loaded
  // project re-serializes byte-identically, but rev always bumps.
  const usage = useMemo(
    () => analyzeUsage(wsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rev]
  );

  // Numeric serial lines become the plot series (resets with each run).
  const plot = useMemo(() => {
    const pts = [];
    for (const l of sim.serial) {
      const n = Number(l);
      if (Number.isFinite(n)) pts.push(n);
    }
    return pts.slice(-PLOT_POINTS);
  }, [sim.serial]);

  useEffect(() => () => runnerRef.current?.stop(), []); // stop on unmount

  useEffect(() => {
    serialEndRef.current?.scrollIntoView({ block: 'end' });
  }, [sim.serial.length]);

  // Flash the TX LED for a beat whenever the program prints.
  useEffect(() => {
    if (sim.txCount === 0) return;
    setTxFlash(true);
    const t = setTimeout(() => setTxFlash(false), 140);
    return () => clearTimeout(t);
  }, [sim.txCount]);

  // Esc leaves fullscreen.
  useEffect(() => {
    if (!fs) return;
    const h = (e) => e.key === 'Escape' && setFs(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fs]);

  function run() {
    runnerRef.current?.stop();
    const runner = new SimRunner(wsRef.current, board, setSim);
    runner.speed = slowMo ? 4 : 1;
    // Carry over whatever the user already set on the widgets.
    for (const [pin, pressed] of Object.entries(buttons)) runner.setDigitalInput(pin, pressed ? 0 : 1);
    for (const [pin, v] of Object.entries(sliders)) runner.setAnalogInput(pin, v);
    runnerRef.current = runner;
    runner.start();
  }

  function stop() { runnerRef.current?.stop(); }

  function toggleSlowMo() {
    setSlowMo((s) => {
      if (runnerRef.current) runnerRef.current.speed = !s ? 4 : 1;
      return !s;
    });
  }

  function clearSerial() {
    runnerRef.current?.clearSerial();
    setSim((s) => ({ ...s, serial: [] }));
  }

  function pressButton(pin, pressed) {
    setButtons((b) => ({ ...b, [pin]: pressed }));
    runnerRef.current?.setDigitalInput(pin, pressed ? 0 : 1); // pressed = LOW (pull-up)
  }

  function moveSlider(pin, v) {
    setSliders((s) => ({ ...s, [pin]: v }));
    runnerRef.current?.setAnalogInput(pin, v);
  }

  // ---- 3D tilt: write the transform straight to the DOM ----------
  function onTiltMove(e) {
    const el = tiltRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const rx = ((e.clientY - r.top) / r.height - 0.5) * -7;
    const ry = ((e.clientX - r.left) / r.width - 0.5) * 7;
    el.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  }
  function onTiltLeave() {
    if (tiltRef.current) tiltRef.current.style.transform = 'perspective(700px)';
  }

  // ---- Board screenshot: SVG → canvas → PNG download -------------
  async function screenshotBoard() {
    const svg = boardWrapRef.current?.querySelector('svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = vb.width * scale;
    canvas.height = vb.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F7F7F7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${board.short}-board.png`;
    a.click();
  }

  const BoardSVG = board.short === 'uno' ? ArduinoUnoSVG : Esp32DevkitSVG;
  const analogPins = [...usage.analogPins].sort();
  const buttonPins = [...usage.buttonPins].sort();

  const boardEl = (
    <div
      style={{ ...S.boardWrap, ...(fs ? S.boardWrapFs : {}) }}
      ref={boardWrapRef}
      onMouseMove={onTiltMove}
      onMouseLeave={onTiltLeave}
    >
      <div ref={tiltRef} style={S.tilt}>
        <BoardSVG
          pins={sim.pins}
          running={sim.running}
          txFlash={txFlash}
          wifi={sim.wifi}
          usage={usage}
          buttons={buttons}
          maxH={fs ? 'min(62vh, 560px)' : undefined}
          onButtonDown={(pin) => pressButton(pin, true)}
          onButtonUp={(pin) => pressButton(pin, false)}
        />
      </div>
    </div>
  );

  return (
    <div style={{ ...S.panel, ...(fs ? S.panelFs : {}) }}>
      {boardEl}

      {/* input widgets (dashed cyan = buttons on the board, green = sliders) */}
      {(buttonPins.length > 0 || analogPins.length > 0) && (
        <div style={S.inputs}>
          {buttonPins.map((pin) => (
            <div key={pin} style={S.inputRow}>
              <button
                style={{ ...S.pushBtn, ...(buttons[pin] ? S.pushBtnDown : {}) }}
                onMouseDown={() => pressButton(pin, true)}
                onMouseUp={() => pressButton(pin, false)}
                onMouseLeave={() => buttons[pin] && pressButton(pin, false)}
              >
                ●
              </button>
              <span style={S.inputLabel}>{board.pinLabel(pin)}</span>
              <span style={S.inputValue}>{buttons[pin] ? 'LOW' : 'HIGH'}</span>
            </div>
          ))}
          {analogPins.map((pin) => (
            <div key={pin} style={S.inputRow}>
              <input
                type="range" min="0" max={board.adcMax} value={sliders[pin] ?? 0}
                onChange={(e) => moveSlider(pin, Number(e.target.value))}
                style={{ flex: 1, accentColor: '#FFD400' }}
              />
              <span style={S.inputLabel}>{board.pinLabel(pin)}</span>
              <span style={S.inputValue}>{sliders[pin] ?? 0}</span>
            </div>
          ))}
        </div>
      )}

      {/* transport — MakeCode-style simulator toolbar */}
      <div style={S.transport}>
        <button style={{ ...S.playBtn, background: sim.running ? '#D83B3B' : '#107C10' }}
                onClick={sim.running ? stop : run}>
          {sim.running ? '■ Stop' : '▶ Run'}
        </button>
        <button style={S.miniBtn} onClick={run} title="Restart">⟳</button>
        <button
          style={{ ...S.miniBtn, ...(slowMo ? S.miniBtnOn : {}) }}
          onClick={toggleSlowMo}
          title="Slow-mo (runs delays 4× slower for debugging)"
        >
          🐢
        </button>
        <button style={S.miniBtn} onClick={screenshotBoard} title="Save a picture of the board">📷</button>
        <button style={S.miniBtn} onClick={() => setFs(!fs)} title={fs ? 'Exit fullscreen (Esc)' : 'Fullscreen board'}>
          {fs ? '🗗' : '⛶'}
        </button>
      </div>

      {/* serial monitor / plotter */}
      <div style={S.serial}>
        <div style={S.serialHead}>
          {[['monitor', 'Monitor'], ['plot', 'Plot']].map(([key, label]) => (
            <button key={key}
                    style={{ ...S.serialTabBtn, ...(serialTab === key ? S.serialTabOn : {}) }}
                    onClick={() => setSerialTab(key)}>
              {label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {serialTab === 'plot' && plotHover != null && plot[plotHover] != null && (
            <span style={S.hoverReadout}>{plot[plotHover]}</span>
          )}
          <button style={S.clearBtn} onClick={clearSerial} title="Clear output">✕ clear</button>
        </div>

        {serialTab === 'monitor' ? (
          <div style={S.serialBody}>
            {sim.serial.length === 0
              ? <span style={{ opacity: 0.4 }}>115200 baud — output appears when the simulation runs</span>
              : sim.serial.map((l, i) => (
                  <div key={i} style={l.startsWith('⚠') ? { color: '#FFB84D' } : undefined}>{l}</div>
                ))}
            <div ref={serialEndRef} />
          </div>
        ) : (
          <SerialPlot points={plot} hover={plotHover} onHover={setPlotHover} />
        )}
      </div>
    </div>
  );
}

// ---- Live plotter: one series, brand line on the dark surface ----
function SerialPlot({ points, hover, onHover }) {
  const W = 300, H = 110, PAD = 8;
  if (points.length < 2) {
    return (
      <div style={{ ...S.serialBody, color: '#7CFC7C' }}>
        <span style={{ opacity: 0.4 }}>
          serial-print numbers and they chart here live — try the “Breathing LED” example
        </span>
      </div>
    );
  }
  let min = Math.min(...points), max = Math.max(...points);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const hi = hover != null && hover < points.length ? hover : points.length - 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ flex: 1, width: '100%', minHeight: 110, display: 'block', cursor: 'crosshair' }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
        onHover(Math.max(0, Math.min(points.length - 1, i)));
      }}
      onMouseLeave={() => onHover(null)}
    >
      {/* recessive grid + min/max in muted ink */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)}
              stroke="#2A2A2A" strokeWidth="1" />
      ))}
      <text x={W - PAD} y={PAD + 3} fontSize="7" fill="#888" textAnchor="end" fontFamily="monospace">{round2(max)}</text>
      <text x={W - PAD} y={H - PAD} fontSize="7" fill="#888" textAnchor="end" fontFamily="monospace">{round2(min)}</text>

      <path d={d} fill="none" stroke="#FFD400" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* current / hovered sample marker with a surface ring */}
      <circle cx={x(hi)} cy={y(points[hi])} r="4.5" fill="#111" />
      <circle cx={x(hi)} cy={y(points[hi])} r="3" fill="#FFD400" />
    </svg>
  );
}

const round2 = (n) => Math.round(n * 100) / 100;

const S = {
  panel: { display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1, overflowY: 'auto' },
  panelFs: {
    position: 'fixed', inset: 0, zIndex: 200, background: '#F2F2F2', padding: '24px max(24px, 15vw)',
    overflowY: 'auto',
  },
  boardWrap: {
    background: '#F7F7F7', borderRadius: 14, padding: 10,
    border: '1px solid #E2E2E2', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.06)',
  },
  boardWrapFs: { display: 'grid', placeItems: 'center', padding: 24 },
  tilt: { transition: 'transform 150ms ease-out', transformStyle: 'preserve-3d', width: '100%' },
  inputs: { display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 4px' },
  inputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  inputLabel: { fontSize: 11, fontFamily: 'monospace', color: '#444', width: 56 },
  inputValue: { fontSize: 11, fontFamily: 'monospace', color: '#8A6D00', marginLeft: 'auto' },
  pushBtn: {
    width: 22, height: 22, borderRadius: '50%', border: '2px solid #999', background: '#DDD',
    color: '#666', cursor: 'pointer', fontSize: 9, lineHeight: '16px', padding: 0, flexShrink: 0,
    transition: 'transform 80ms, background 80ms',
  },
  pushBtnDown: { background: '#00E5FF', color: '#003A42', borderColor: '#00B8CC', transform: 'scale(0.88)' },
  transport: { display: 'flex', gap: 6 },
  playBtn: {
    flex: 1, border: 'none', borderRadius: 10, padding: '10px 0', color: '#FFF',
    fontWeight: 700, fontSize: 14, cursor: 'pointer',
  },
  miniBtn: {
    width: 40, border: '2px solid #DDD', borderRadius: 10, background: '#FFF',
    fontSize: 15, cursor: 'pointer', padding: 0,
  },
  miniBtnOn: { background: '#FFD400', borderColor: '#D9B400' },
  serial: {
    flex: 1, minHeight: 96, display: 'flex', flexDirection: 'column',
    background: '#111', borderRadius: 10, overflow: 'hidden',
  },
  serialHead: {
    display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px',
    borderBottom: '1px solid #222',
  },
  serialTabBtn: {
    border: 'none', background: 'transparent', color: '#888', fontSize: 11, fontWeight: 700,
    padding: '4px 10px', borderRadius: 6, cursor: 'pointer', textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  serialTabOn: { background: '#2A2A2A', color: '#FFD400' },
  hoverReadout: { fontSize: 11, fontFamily: 'monospace', color: '#DDD', marginRight: 8 },
  clearBtn: {
    border: 'none', background: 'transparent', color: '#666', fontSize: 10.5, cursor: 'pointer',
  },
  serialBody: {
    flex: 1, overflowY: 'auto', padding: '8px 10px', fontFamily: 'monospace',
    fontSize: 12, color: '#7CFC7C', lineHeight: 1.5, whiteSpace: 'pre-wrap',
  },
};
