// ============================================================
// STACK LAYER: Frontend / Hardware Interface (Web Serial)
// Wraps esptool-js. Given [{offset, data: ArrayBuffer}] it:
//   1. requests a serial port from the user,
//   2. enters download mode automatically via DTR/RTS toggling
//      (loader.main() drives EN/IO0 — no BOOT button needed),
//   3. writes each artifact to flash with progress callbacks,
//   4. hard-resets the board so the sketch starts immediately.
// ============================================================
import { useCallback, useRef, useState } from 'react';

const BAUD = 115200; // DevKit V1 CH340/CP2102 sweet spot; higher rates flake on cheap cables

export function useWebSerial() {
  const [flashState, setFlashState] = useState('idle'); // idle|connecting|flashing|done|error
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const transportRef = useRef(null);

  const supported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const appendLog = (line) => setLog((prev) => [...prev.slice(-200), line]);

  /**
   * @param {Array<{offset:number, data:ArrayBuffer}>} files
   *   e.g. [{offset:0x1000, data:…bootloader}, …, {offset:0x10000, data:…app}]
   */
  const flash = useCallback(async (files) => {
    if (!supported) {
      setFlashState('error');
      appendLog('Web Serial is not available. Use Chrome/Edge on desktop (not iOS/Firefox).');
      return;
    }

    let transport = null;
    try {
      setFlashState('connecting');
      setProgress(0);

      // esptool-js is ~200 KB nobody pays for until they actually flash.
      const { ESPLoader, Transport } = await import('esptool-js');

      // Must be called from a user gesture (button click) or Chrome rejects it.
      const port = await navigator.serial.requestPort();
      transport = new Transport(port, /* traceOn */ false);
      transportRef.current = transport;

      const loader = new ESPLoader({
        transport,
        baudrate: BAUD,
        // esptool-js pipes bootloader chatter here → surfaced in the UI console.
        terminal: {
          clean: () => setLog([]),
          write: (s) => appendLog(s),
          writeLine: (s) => appendLog(s),
        },
      });

      // main() syncs with the ROM bootloader, toggling DTR (→ IO0) and
      // RTS (→ EN) so the student never touches the physical BOOT button.
      appendLog('Entering download mode…');
      await loader.main();

      // esptool-js expects binary strings, not ArrayBuffers.
      const toBinaryString = (buf) => {
        const bytes = new Uint8Array(buf);
        let out = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return out;
      };

      const totalBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
      let writtenBefore = 0;

      setFlashState('flashing');
      await loader.writeFlash({
        fileArray: files.map((f) => ({ address: f.offset, data: toBinaryString(f.data) })),
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          // Aggregate across all artifacts into a single 0–100 bar.
          const before = files.slice(0, fileIndex).reduce((n, f) => n + f.data.byteLength, 0);
          const pct = Math.min(100, Math.round(((before + written) / totalBytes) * 100));
          setProgress(pct);
          void writtenBefore; void total;
        },
      });

      appendLog('Flash complete. Resetting board…');
      await loader.after(); // hard reset via RTS → sketch boots
      setProgress(100);
      setFlashState('done');
    } catch (err) {
      setFlashState('error');
      // ---- Targeted error copy for the three classroom failure modes ----
      if (err?.name === 'NotFoundError') {
        // User closed the port picker, OR the board never appeared in it.
        appendLog(
          'No board selected. If your ESP32 was not in the list, its USB driver may be ' +
          'missing — install the CP2102 (Silicon Labs) or CH340 (WCH) driver, replug, and retry. ' +
          'Also check the cable: many micro-USB cables are charge-only.'
        );
      } else if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
        appendLog('The operating system blocked access to the USB port. Close the Arduino IDE or any serial monitor using the board, then retry.');
      } else if (err?.name === 'NetworkError' || /open/i.test(err?.message ?? '')) {
        appendLog('Could not open the port — it is probably held by another program. Close other tabs/apps using the board.');
      } else if (/sync/i.test(err?.message ?? '')) {
        appendLog('The board did not answer the bootloader handshake. Hold the BOOT button while clicking Upload as a fallback.');
      } else {
        appendLog(`Upload error: ${err?.message ?? err}`);
      }
    } finally {
      // Always release the port so the next attempt can claim it.
      try { await transport?.disconnect(); } catch { /* already closed */ }
      transportRef.current = null;
    }
  }, [supported]);

  return { flash, flashState, progress, log, supported };
}
