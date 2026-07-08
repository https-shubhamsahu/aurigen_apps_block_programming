// ============================================================
// STACK LAYER: Frontend / Hardware Bridge (Arduino Uno)
// STK500v1 programmer over Web Serial — talks directly to the
// optiboot bootloader every Uno R3 ships with. No agent, no
// drivers beyond the usual CH340/FTDI, no avrdude: the browser
// IS the programmer.
//
// Protocol (115200 baud):
//   DTR pulse            → auto-reset into the bootloader
//   0x30 0x20            → sync            (expect 0x14 0x10)
//   0x75 0x20            → read signature  (expect 1E 95 0F = m328p)
//   0x50 0x20            → enter prog mode
//   0x55 lo hi 0x20      → load word address
//   0x64 0x00 0x80 F …   → program 128-byte flash page
//   0x51 0x20            → leave prog mode → sketch boots
// ============================================================
import { useState } from 'react';
import { parseIntelHex } from '../simulator/hex.js';

const CRC_EOP = 0x20;
const STK = {
  GET_SYNC: 0x30, ENTER_PROGMODE: 0x50, LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55, PROG_PAGE: 0x64, READ_SIGN: 0x75,
  INSYNC: 0x14, OK: 0x10,
};
const PAGE_SIZE = 128; // ATmega328P flash page

export function useAvrFlash() {
  const [flashState, setFlashState] = useState('idle'); // idle|connecting|flashing|done|error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator;

  async function flashHex(hexText) {
    setError(null);
    setProgress(0);
    setFlashState('connecting');

    let port;
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });

      const reader = port.readable.getReader();
      const writer = port.writable.getWriter();
      const rx = []; // byte queue fed by a background pump

      let pumping = true;
      (async () => { // background pump: reader → rx byte queue
        try {
          while (pumping) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) rx.push(...value);
          }
        } catch { /* port closed */ }
      })();

      const readExact = async (n, timeoutMs = 800) => {
        const deadline = Date.now() + timeoutMs;
        while (rx.length < n) {
          if (Date.now() > deadline) throw new Error('Board did not answer in time.');
          await new Promise((r) => setTimeout(r, 10));
        }
        return rx.splice(0, n);
      };

      const cmd = async (bytes, replyLen = 2, timeoutMs = 800) => {
        await writer.write(new Uint8Array(bytes));
        const reply = await readExact(replyLen, timeoutMs);
        if (reply[0] !== STK.INSYNC || reply[replyLen - 1] !== STK.OK) {
          throw new Error(`Programmer out of sync (got ${reply.map((b) => b.toString(16)).join(' ')}).`);
        }
        return reply.slice(1, replyLen - 1);
      };

      // --- auto-reset into optiboot ------------------------------------
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await new Promise((r) => setTimeout(r, 250));
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
      await new Promise((r) => setTimeout(r, 50));
      rx.length = 0; // drop boot noise

      // --- sync (optiboot listens for ~1 s after reset) -----------------
      let synced = false;
      for (let i = 0; i < 8 && !synced; i++) {
        try {
          await writer.write(new Uint8Array([STK.GET_SYNC, CRC_EOP]));
          const reply = await readExact(2, 300);
          synced = reply[0] === STK.INSYNC && reply[1] === STK.OK;
        } catch { /* retry */ }
        if (!synced) rx.length = 0;
      }
      if (!synced) {
        throw new Error(
          'Could not reach the bootloader. Check the USB cable, close the Arduino IDE / serial monitors, and try again.'
        );
      }

      // --- confirm we are really talking to an ATmega328P ---------------
      const sig = await cmd([STK.READ_SIGN, CRC_EOP], 5);
      if (!(sig[0] === 0x1e && sig[1] === 0x95 && sig[2] === 0x0f)) {
        throw new Error(`This doesn't look like an Uno (signature ${sig.map((b) => b.toString(16)).join(' ')}).`);
      }

      await cmd([STK.ENTER_PROGMODE, CRC_EOP]);

      // --- program pages -------------------------------------------------
      setFlashState('flashing');
      const { data, maxAddress } = parseIntelHex(hexText);
      const pages = Math.ceil(maxAddress / PAGE_SIZE);
      for (let p = 0; p < pages; p++) {
        const byteAddr = p * PAGE_SIZE;
        const wordAddr = byteAddr >> 1;
        await cmd([STK.LOAD_ADDRESS, wordAddr & 0xff, (wordAddr >> 8) & 0xff, CRC_EOP]);
        const page = data.subarray(byteAddr, byteAddr + PAGE_SIZE);
        await cmd([
          STK.PROG_PAGE, (PAGE_SIZE >> 8) & 0xff, PAGE_SIZE & 0xff, 0x46 /* 'F' = flash */,
          ...page, CRC_EOP,
        ], 2, 2000);
        setProgress(Math.round(((p + 1) / pages) * 100));
      }

      await cmd([STK.LEAVE_PROGMODE, CRC_EOP]); // board resets into the sketch

      pumping = false;
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      writer.releaseLock();
      await port.close();

      setFlashState('done');
      setTimeout(() => setFlashState('idle'), 2500);
    } catch (e) {
      setError(e.message);
      setFlashState('error');
      try { await port?.close(); } catch { /* already closed */ }
      throw e;
    }
  }

  return { flashHex, avrFlashState: flashState, avrProgress: progress, avrError: error, avrSupported: supported };
}
