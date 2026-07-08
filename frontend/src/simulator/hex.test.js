import { describe, it, expect } from 'vitest';
import { parseIntelHex } from './hex.js';

// Two data records + EOF, hand-checked checksums.
//   @0x0000: 0C 94 5D 00   @0x0010: AA BB
const SAMPLE = [
  ':040000000C945D00FF',
  ':02001000AABB89',
  ':00000001FF',
].join('\n');

describe('parseIntelHex', () => {
  it('places data records at their addresses', () => {
    const { data, maxAddress } = parseIntelHex(SAMPLE);
    expect([...data.slice(0, 4)]).toEqual([0x0c, 0x94, 0x5d, 0x00]);
    expect([...data.slice(0x10, 0x12)]).toEqual([0xaa, 0xbb]);
    expect(maxAddress).toBe(0x12);
  });

  it('leaves untouched flash erased (0xFF)', () => {
    const { data } = parseIntelHex(SAMPLE);
    expect(data[0x08]).toBe(0xff);
  });

  it('rejects a corrupted checksum', () => {
    expect(() => parseIntelHex(':0400000A0C945D00FF\n:00000001FF')).toThrow(/checksum/i);
  });

  it('rejects an empty file', () => {
    expect(() => parseIntelHex(':00000001FF')).toThrow(/no code/i);
  });

  it('honors extended linear address records', () => {
    // 0x04 record sets base 0x0001_0000 — beyond a 328P's 32K, so with the
    // default capacity the byte lands nowhere and the file reads as empty.
    const ext = [':020000040001F9', ':01000000AA55', ':00000001FF'].join('\n');
    expect(() => parseIntelHex(ext)).toThrow(/no code/i);
    // …but with enough capacity it lands at exactly 0x10000.
    const { data } = parseIntelHex(ext, 0x20000);
    expect(data[0x10000]).toBe(0xaa);
  });
});
