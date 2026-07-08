import { describe, it, expect, beforeAll } from 'vitest';
import { encodeShare, decodeShare } from './share.js';

beforeAll(() => {
  // share.js reads location for the link prefix
  globalThis.location = { origin: 'https://aurigen.test', pathname: '/' };
});

describe('share links', () => {
  it('round-trips workspace XML through the URL hash', () => {
    const xml = '<xml><block type="esp32_delay"><field name="MS">500</field></block></xml>';
    const url = encodeShare('arduino_uno_r3', xml);
    const hash = new URL(url).hash;
    expect(decodeShare(hash)).toEqual({ boardId: 'arduino_uno_r3', xml });
  });

  it('survives unicode in block fields', () => {
    const xml = '<xml><field name="TEXT">नमस्ते 🌟 déjà</field></xml>';
    const { xml: back } = decodeShare(new URL(encodeShare('esp32_devkit_v1', xml)).hash);
    expect(back).toBe(xml);
  });

  it('returns null for junk hashes instead of throwing', () => {
    expect(decodeShare('#s=board.!!!not-base64!!!')).toBeNull();
    expect(decodeShare('#access_token=abc&type=recovery')).toBeNull(); // Supabase recovery hash
    expect(decodeShare('')).toBeNull();
    expect(decodeShare(null)).toBeNull();
  });
});
