// ============================================================
// STACK LAYER: Frontend / Sharing
// Zero-backend share links: the whole program travels in the
// URL hash as base64url(workspace XML), namespaced by board.
//   https://app/#s=<boardId>.<payload>
// Nothing is uploaded anywhere; whoever has the link can open
// the program in their own account.
// ============================================================

export function encodeShare(boardId, xml) {
  const bytes = new TextEncoder().encode(xml);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const payload = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#s=${boardId}.${payload}`;
}

/** Returns { boardId, xml } or null if the hash is not a share link. */
export function decodeShare(hash) {
  const m = /^#s=([a-z0-9_]+)\.([A-Za-z0-9\-_]+)$/.exec(hash ?? '');
  if (!m) return null;
  try {
    const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return { boardId: m[1], xml: new TextDecoder().decode(bytes) };
  } catch {
    return null; // malformed link → fall through to the home screen
  }
}
