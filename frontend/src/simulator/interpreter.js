// ============================================================
// STACK LAYER: Frontend / Simulator Engine
// MakeCode-style board simulator. Interprets the Blockly block
// tree DIRECTLY (the C++ never runs here) with the same
// semantics the generated sketch has on real hardware:
//   * all top-level statement chains run in order, forever (loop())
//   * WiFi connect happens once up front (setup())
//   * digitalRead pins are INPUT_PULLUP → idle HIGH, pressed LOW
// Pins are keyed by their dropdown VALUE string ('16', '13', 'A0'…)
// so the same engine drives the ESP32 and the Uno. The runner
// re-reads the workspace every loop pass, so students can edit
// blocks while the simulation is running — like MakeCode.
// ============================================================

const MAX_SERIAL_LINES = 300;
const MIN_LOOP_MS = 15; // a delay-less forever loop must still yield to the UI

/** Static scan: which pins/features does the program use? Drives the board UI. */
export function analyzeUsage(workspace) {
  const usage = {
    ledPins: new Set(),     // written via digitalWrite / PWM → glow on the board
    buttonPins: new Set(),  // digitalRead → clickable pads
    analogPins: new Set(),  // analogRead → sliders
    hasWifi: false,
    hasSerial: false,
  };
  if (!workspace) return usage;
  for (const b of workspace.getAllBlocks(false)) {
    switch (b.type) {
      case 'esp32_digital_write':
      case 'esp32_pwm_write': usage.ledPins.add(b.getFieldValue('PIN')); break;
      case 'esp32_digital_read': usage.buttonPins.add(b.getFieldValue('PIN')); break;
      case 'esp32_analog_read': usage.analogPins.add(b.getFieldValue('PIN')); break;
      case 'esp32_wifi_connect': usage.hasWifi = true; break;
      case 'esp32_serial_print': usage.hasSerial = true; break;
      default: break;
    }
  }
  return usage;
}

export class SimRunner {
  /**
   * @param {*} workspace  live Blockly workspace (read every loop pass)
   * @param {*} board      board config (adcMax is the only field used here)
   * @param {(state) => void} onUpdate  called with {pins, serial, wifi, running, txCount}
   */
  constructor(workspace, board, onUpdate) {
    this.ws = workspace;
    this.board = board;
    this.onUpdate = onUpdate;
    this.running = false;
    this.speed = 1;        // slow-mo multiplier (1 = real time, 4 = debug pace)
    this.pins = {};        // pin -> 0..255 output level (HIGH = 255)
    this.digitalIn = {};   // pin -> 0|1 (default 1: INPUT_PULLUP idle)
    this.analogIn = {};    // pin -> 0..adcMax
    this.vars = {};
    this.serial = [];
    this.txCount = 0;      // bumps on every print → TX LED flash in the UI
    this.wifi = 'off';     // off|connecting|connected
    this._timer = null;
    this._wake = null;
  }

  emit() {
    this.onUpdate({
      pins: { ...this.pins },
      serial: this.serial.slice(),
      wifi: this.wifi,
      running: this.running,
      txCount: this.txCount,
    });
  }

  log(line) {
    this.serial.push(line);
    if (this.serial.length > MAX_SERIAL_LINES) this.serial.shift();
  }

  clearSerial() { this.serial = []; this.emit(); }

  setDigitalInput(pin, value) { this.digitalIn[pin] = value ? 1 : 0; }
  setAnalogInput(pin, value) {
    this.analogIn[pin] = Math.max(0, Math.min(this.board.adcMax, Number(value) || 0));
  }

  sleep(ms) {
    return new Promise((resolve) => {
      this._wake = resolve;
      this._timer = setTimeout(resolve, ms * this.speed);
    });
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._wake?.(); // abort any in-flight delay immediately
    this.emit();
  }

  async start() {
    this.running = true;
    this.pins = {}; this.vars = {}; this.serial = []; this.wifi = 'off';

    // --- setup(): WiFi block behaves like the generated boilerplate ---
    if (this.ws.getAllBlocks(false).some((b) => b.type === 'esp32_wifi_connect')) {
      this.wifi = 'connecting';
      this.log('Connecting to WiFi....');
      this.emit();
      await this.sleep(1200);
      if (!this.running) return;
      this.wifi = 'connected';
      this.log('Connected!');
    }
    this.emit();

    // --- loop(): every top-level statement chain, forever ---
    while (this.running) {
      const t0 = Date.now();
      // Re-read tops each pass so live edits take effect next cycle.
      const tops = this.ws.getTopBlocks(true).filter((b) => b.previousConnection);
      for (const b of tops) {
        try {
          await this.runChain(b);
        } catch (e) {
          this.log(`⚠ simulator: ${e.message}`); // block deleted mid-run, etc.
        }
        if (!this.running) return;
      }
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_LOOP_MS) await this.sleep(MIN_LOOP_MS - elapsed);
      this.emit();
    }
  }

  async runChain(block) {
    let b = block;
    while (b && this.running) {
      await this.exec(b);
      b = b.getNextBlock();
    }
  }

  async exec(b) {
    switch (b.type) {
      case 'esp32_digital_write': {
        const pin = b.getFieldValue('PIN');
        this.pins[pin] = b.getFieldValue('STATE') === 'HIGH' ? 255 : 0;
        this.emit();
        break;
      }
      case 'esp32_pwm_write': {
        const pin = b.getFieldValue('PIN');
        const duty = Number(await this.value(b, 'DUTY')) || 0;
        this.pins[pin] = Math.max(0, Math.min(255, Math.round(duty)));
        this.emit();
        break;
      }
      case 'esp32_delay': {
        this.emit();
        await this.sleep(Number(b.getFieldValue('MS')) || 0);
        break;
      }
      case 'esp32_serial_print': {
        const v = await this.value(b, 'TEXT');
        this.log(typeof v === 'boolean' ? (v ? 'HIGH' : 'LOW') : String(v));
        this.txCount++;
        this.emit();
        break;
      }
      case 'esp32_wifi_connect':
        break; // already handled in the setup() phase
      case 'variables_set':
        this.vars[this.varName(b)] = await this.value(b, 'VALUE');
        break;
      case 'math_change':
        this.vars[this.varName(b)] =
          (Number(this.vars[this.varName(b)]) || 0) + (Number(await this.value(b, 'DELTA')) || 0);
        break;
      case 'controls_if': {
        let taken = false;
        for (let n = 0; b.getInput('IF' + n); n++) {
          if (await this.value(b, 'IF' + n)) {
            await this.runChain(b.getInputTargetBlock('DO' + n));
            taken = true;
            break;
          }
        }
        if (!taken && b.getInput('ELSE')) {
          await this.runChain(b.getInputTargetBlock('ELSE'));
        }
        break;
      }
      case 'controls_repeat_ext': {
        const times = Math.floor(Number(await this.value(b, 'TIMES')) || 0);
        for (let i = 0; i < times && this.running; i++) {
          await this.runChain(b.getInputTargetBlock('DO'));
          if (i % 200 === 199) await this.sleep(1); // keep the tab responsive
        }
        break;
      }
      case 'controls_whileUntil': {
        const until = b.getFieldValue('MODE') === 'UNTIL';
        let guard = 0;
        while (this.running) {
          const cond = Boolean(await this.value(b, 'BOOL'));
          if (until ? cond : !cond) break;
          await this.runChain(b.getInputTargetBlock('DO'));
          if (++guard % 200 === 0) await this.sleep(1);
        }
        break;
      }
      default:
        break; // unknown statement block: skip rather than crash the run
    }
  }

  varName(b) { return b.getField('VAR')?.getText() ?? '?'; }

  /** Evaluate the block plugged into an input socket (0 if empty). */
  async value(b, inputName) {
    const t = b.getInputTargetBlock(inputName);
    return t ? this.evalBlock(t) : 0;
  }

  async evalBlock(b) {
    switch (b.type) {
      case 'math_number': return Number(b.getFieldValue('NUM'));
      case 'text': return b.getFieldValue('TEXT') ?? '';
      case 'logic_boolean': return b.getFieldValue('BOOL') === 'TRUE';
      case 'variables_get': return this.vars[this.varName(b)] ?? 0;
      case 'esp32_digital_read':
        return (this.digitalIn[b.getFieldValue('PIN')] ?? 1) === 1; // pull-up: idle HIGH
      case 'esp32_analog_read':
        return this.analogIn[b.getFieldValue('PIN')] ?? 0;
      case 'math_arithmetic': {
        const a = Number(await this.value(b, 'A')) || 0;
        const c = Number(await this.value(b, 'B')) || 0;
        switch (b.getFieldValue('OP')) {
          case 'MINUS': return a - c;
          case 'MULTIPLY': return a * c;
          case 'DIVIDE': return c === 0 ? 0 : a / c;
          default: return a + c;
        }
      }
      case 'logic_compare': {
        const a = await this.value(b, 'A');
        const c = await this.value(b, 'B');
        switch (b.getFieldValue('OP')) {
          case 'NEQ': return a != c; // eslint-disable-line eqeqeq
          case 'LT': return a < c;
          case 'LTE': return a <= c;
          case 'GT': return a > c;
          case 'GTE': return a >= c;
          default: return a == c; // eslint-disable-line eqeqeq
        }
      }
      case 'logic_operation': {
        const and = b.getFieldValue('OP') === 'AND';
        const a = Boolean(await this.value(b, 'A'));
        const c = Boolean(await this.value(b, 'B'));
        return and ? a && c : a || c;
      }
      case 'logic_negate':
        return !(await this.value(b, 'BOOL'));
      default:
        return 0;
    }
  }
}
