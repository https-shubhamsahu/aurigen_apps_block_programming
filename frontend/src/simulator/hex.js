// ============================================================
// STACK LAYER: Frontend / Firmware plumbing
// Minimal Intel HEX parser shared by the avr8js firmware engine
// and the STK500 Web Serial flasher. Handles data (00), EOF (01),
// extended segment (02) and extended linear (04) records — all an
// avr-gcc / arduino-cli .hex will ever contain.
// ============================================================

/**
 * @param {string} hexText  Intel HEX file contents
 * @param {number} capacity Flash size in bytes (ATmega328P = 32768)
 * @returns {{ data: Uint8Array, maxAddress: number }}
 */
export function parseIntelHex(hexText, capacity = 32768) {
  const data = new Uint8Array(capacity).fill(0xff); // erased-flash default
  let base = 0;
  let maxAddress = 0;

  for (const raw of hexText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;

    const bytes = [];
    for (let i = 1; i < line.length; i += 2) {
      bytes.push(parseInt(line.slice(i, i + 2), 16));
    }
    const [count, addrHi, addrLo, type] = bytes;
    const payload = bytes.slice(4, 4 + count);

    // checksum: two's complement of the sum of everything before it
    const sum = bytes.slice(0, 4 + count).reduce((a, b) => a + b, 0);
    if (((sum + bytes[4 + count]) & 0xff) !== 0) {
      throw new Error('Corrupt firmware file (bad HEX checksum).');
    }

    if (type === 0x00) {
      const addr = base + ((addrHi << 8) | addrLo);
      for (let i = 0; i < payload.length; i++) {
        if (addr + i < capacity) {
          data[addr + i] = payload[i];
          maxAddress = Math.max(maxAddress, addr + i + 1);
        }
      }
    } else if (type === 0x01) {
      break; // EOF
    } else if (type === 0x02) {
      base = ((payload[0] << 8) | payload[1]) << 4;
    } else if (type === 0x04) {
      base = ((payload[0] << 8) | payload[1]) << 16;
    }
    // 03/05 (start address) carry no data — ignored
  }

  if (maxAddress === 0) throw new Error('Firmware file contains no code.');
  return { data, maxAddress };
}
