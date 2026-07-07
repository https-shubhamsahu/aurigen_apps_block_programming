// ============================================================
// STACK LAYER: Frontend / Simulation Engines / Firmware (AVR)
// Executes the REAL compiled .hex on a simulated ATmega328P using
// avr8js (MIT, by Wokwi's author) — the same silicon-level core
// Wokwi builds on. This is not a block interpreter: it runs the
// exact machine code arduino-cli produced, timers and all.
//
// Engine contract (mirrors SimRunner so <Simulator> can swap them):
//   new AvrRunner(hexText, board, onUpdate) → .start() .stop()
//   .speed (1 = real-time-ish, 4 = slow-mo)
//   .setDigitalInput(pin, 0|1)   .setAnalogInput(pin, raw)
//   .clearSerial()
// Emits { pins: {name: 0..255 duty}, serial, wifi, running, txCount }.
//
// PWM is measured, not guessed: port listeners integrate high-time
// in CPU cycles per UI window, so analogWrite(…) renders as true
// duty-cycle brightness.
// ============================================================
import {
  CPU, avrInstruction, AVRIOPort, AVRTimer, AVRUSART, AVRADC, PinState,
  portBConfig, portCConfig, portDConfig,
  timer0Config, timer1Config, timer2Config, usart0Config, adcConfig,
} from 'avr8js';
import { parseIntelHex } from '../hex.js';

const FREQ = 16_000_000; // Uno crystal
const MAX_SERIAL_LINES = 300;
const TICK_MS = 10;          // execution slice cadence
const MAX_SLICE_MS = 6;      // never hog more than this per slice — UI stays alive

// Arduino Uno pin → [port, bit]. ADC channel = index for A0–A5.
const PORT_OF = {};
for (let d = 0; d <= 7; d++) PORT_OF[String(d)] = ['D', d];
for (let d = 8; d <= 13; d++) PORT_OF[String(d)] = ['B', d - 8];
for (let a = 0; a <= 5; a++) PORT_OF[`A${a}`] = ['C', a];

export class AvrRunner {
  constructor(hexText, board, onUpdate) {
    this.onUpdate = onUpdate;
    this.board = board;
    this.speed = 1;
    this.running = false;
    this.serial = [];
    this.txCount = 0;
    this.pins = {};
    this._serialLine = '';
    this._interval = null;

    const { data } = parseIntelHex(hexText);
    const program = new Uint16Array(0x8000 / 2);
    new Uint8Array(program.buffer).set(data);

    this.cpu = new CPU(program);
    // Timers make millis()/delay()/PWM hardware work like the real chip.
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    };
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.usart = new AVRUSART(this.cpu, usart0Config, FREQ);
    this.usart.onByteTransmit = (byte) => this._onSerialByte(byte);

    // --- duty-cycle accounting per pin -------------------------------
    this._watch = {};
    for (const [name, [portKey, bit]] of Object.entries(PORT_OF)) {
      this._watch[name] = { portKey, bit, acc: 0, lastCycle: 0, level: 0 };
    }
    this._windowStart = 0;
    for (const [key, port] of Object.entries(this.ports)) {
      port.addListener(() => {
        const cycles = this.cpu.cycles;
        for (const st of Object.values(this._watch)) {
          if (st.portKey !== key) continue;
          const lvl = port.pinState(st.bit) === PinState.High ? 1 : 0;
          if (lvl !== st.level) {
            st.acc += (cycles - st.lastCycle) * st.level;
            st.lastCycle = cycles;
            st.level = lvl;
          }
        }
      });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._windowStart = this.cpu.cycles;
    let deficit = 0; // cycles we still owe from previous slices
    this._interval = setInterval(() => {
      const budget = Math.floor((FREQ * TICK_MS) / 1000 / this.speed) + deficit;
      const deadline = performance.now() + MAX_SLICE_MS;
      const target = this.cpu.cycles + budget;
      // Check the wall clock only every 2k instructions — cheap and safe.
      while (this.cpu.cycles < target) {
        for (let i = 0; i < 2000 && this.cpu.cycles < target; i++) {
          avrInstruction(this.cpu);
          this.cpu.tick();
        }
        if (performance.now() >= deadline) break;
      }
      deficit = Math.min(Math.max(target - this.cpu.cycles, 0), FREQ / 10);
      this._flushPins();
      this._emit();
    }, TICK_MS);
    this._emit();
  }

  stop() {
    clearInterval(this._interval);
    this._interval = null;
    this.running = false;
    this._emit();
  }

  /** Physical pin drive from the UI widgets (buttons idle HIGH via pull-up). */
  setDigitalInput(pin, value) {
    const map = PORT_OF[String(pin)];
    if (!map) return;
    this.ports[map[0]].setPin(map[1], !!value);
  }

  /** raw is in the board's ADC scale (Uno: 0–1023) → volts on the channel. */
  setAnalogInput(pin, raw) {
    const ch = Number(String(pin).replace(/^A/, ''));
    if (Number.isInteger(ch) && ch >= 0 && ch <= 5) {
      this.adc.channelValues[ch] = (raw / (this.board.adcMax || 1023)) * 5;
    }
  }

  clearSerial() {
    this.serial = [];
    this._serialLine = '';
    this._emit();
  }

  // ---- internals ----------------------------------------------------

  _onSerialByte(byte) {
    this.txCount += 1;
    if (byte === 0x0a) {
      this.serial.push(this._serialLine);
      if (this.serial.length > MAX_SERIAL_LINES) this.serial.shift();
      this._serialLine = '';
    } else if (byte !== 0x0d) {
      this._serialLine += String.fromCharCode(byte);
      if (this._serialLine.length > 200) { // runaway prints without newline
        this.serial.push(this._serialLine);
        this._serialLine = '';
      }
    }
  }

  /** Close the duty window and turn cycle-time into 0–255 pin levels. */
  _flushPins() {
    const cycles = this.cpu.cycles;
    const window = cycles - this._windowStart;
    if (window <= 0) return;
    for (const [name, st] of Object.entries(this._watch)) {
      st.acc += (cycles - st.lastCycle) * st.level;
      st.lastCycle = cycles;
      this.pins[name] = Math.round((st.acc / window) * 255);
      st.acc = 0;
    }
    this._windowStart = cycles;
  }

  _emit() {
    this.onUpdate({
      pins: { ...this.pins },
      serial: [...this.serial],
      wifi: 'off',              // no radio on an ATmega328P
      running: this.running,
      txCount: this.txCount,
    });
  }
}
