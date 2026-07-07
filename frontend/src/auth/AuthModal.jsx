// ============================================================
// STACK LAYER: Frontend / Auth Modal (only shown on demand)
// Appears when a guest reaches for a cloud feature — never as a
// wall. The copy explains what the account buys in that moment.
// Modes: signin ⇄ signup, forgot (reset email), recover (from a
// recovery link — cannot be dismissed into a broken state).
// ============================================================
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { signIn, signUp, sendPasswordReset, updatePassword } from '../lib/supabaseClient';

const REASONS = {
  generic:  { title: 'Welcome back', benefit: 'Sign in to sync projects, compile in the cloud, and pick up where you left off on any device.' },
  compile:  { title: 'Almost there — one free account', benefit: 'Compiling runs on our cloud build servers (real arduino-cli, real firmware). A free account keeps the service fair for everyone.' },
  cloud:    { title: 'Save to your account', benefit: 'Projects saved to your account open on any device and never leave your browser otherwise.' },
  recover:  { title: 'Set a new password', benefit: 'Choose a new password to finish resetting your account.' },
};

export default function AuthModal({ reason = 'generic', onClose }) {
  const { session } = useAuth();
  const [mode, setMode] = useState(reason === 'recover' ? 'recover' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Once a session exists (and we're not mid-recovery), the job is done.
  useEffect(() => {
    if (session && mode !== 'recover') onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const copy = REASONS[mode === 'recover' ? 'recover' : reason] ?? REASONS.generic;

  async function submit() {
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password); // session effect closes the modal
      } else if (mode === 'signup') {
        await signUp(email, password);
        setNotice({ ok: true, text: 'Check your inbox to confirm your email, then sign in here.' });
        setMode('signin');
      } else if (mode === 'forgot') {
        await sendPasswordReset(email);
        setNotice({ ok: true, text: 'Reset link sent — check your inbox.' });
        setMode('signin');
      } else if (mode === 'recover') {
        if (password.length < 8) throw new Error('Use at least 8 characters.');
        await updatePassword(password);
        onClose();
      }
    } catch (e) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const cta = { signin: 'Sign in', signup: 'Create free account', forgot: 'Send reset link', recover: 'Set new password' }[mode];

  return (
    <div style={S.overlay} onClick={mode === 'recover' ? undefined : onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        {mode !== 'recover' && (
          <button style={S.close} onClick={onClose} title="Keep building without an account">✕</button>
        )}

        <div style={S.brandRow}>
          <span style={S.brand}>Aurigen<span style={{ color: '#D9B400' }}>.</span></span>
        </div>
        <h2 style={S.title}>{mode === 'signup' ? 'Create your free account' : copy.title}</h2>
        <p style={S.benefit}>{copy.benefit}</p>

        {mode !== 'recover' && (
          <input
            style={S.input} type="email" placeholder="Email" value={email}
            autoFocus autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {mode !== 'forgot' && (
          <input
            style={S.input} type="password"
            placeholder={mode === 'recover' ? 'New password (8+ characters)' : 'Password'}
            value={password}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}

        {notice && (
          <div style={{ ...S.notice, ...(notice.ok ? S.noticeOk : S.noticeErr) }}>{notice.text}</div>
        )}

        <button style={{ ...S.cta, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
          {busy ? 'One moment…' : cta}
        </button>

        {mode !== 'recover' && (
          <div style={S.links}>
            <button style={S.link} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setNotice(null); }}>
              {mode === 'signin' ? 'New here? Create an account' : 'Already registered? Sign in'}
            </button>
            {mode === 'signin' && (
              <button style={S.link} onClick={() => { setMode('forgot'); setNotice(null); }}>
                Forgot password?
              </button>
            )}
          </div>
        )}

        {mode !== 'recover' && reason !== 'generic' && (
          <button style={S.skip} onClick={onClose}>← Keep building without an account</button>
        )}
      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.55)', backdropFilter: 'blur(3px)',
    display: 'grid', placeItems: 'center', zIndex: 250, fontFamily: "'Inter', system-ui, sans-serif",
  },
  modal: {
    position: 'relative', width: 'min(400px, 92vw)', background: '#FFF', borderRadius: 20,
    padding: '28px 28px 22px', boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
  },
  close: {
    position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 8,
    border: 'none', background: '#F2F2F2', color: '#888', cursor: 'pointer', fontSize: 13,
  },
  brandRow: { marginBottom: 10 },
  brand: { fontWeight: 800, fontSize: 17, background: '#FFD400', borderRadius: 8, padding: '4px 10px' },
  title: { margin: '4px 0 6px', fontSize: 21, letterSpacing: '-0.01em' },
  benefit: { margin: '0 0 16px', fontSize: 13.5, color: '#666', lineHeight: 1.5 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 10,
    border: '2px solid #F0EAC0', borderRadius: 10, fontSize: 15, outlineColor: '#FFD400',
  },
  notice: { borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 10 },
  noticeOk: { background: '#EFFBEF', color: '#1B6E1B' },
  noticeErr: { background: '#FFF2F0', color: '#B3261E' },
  cta: {
    width: '100%', border: 'none', borderRadius: 12, padding: '13px 0', background: '#FFD400',
    color: '#1A1A1A', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 2px 0 #D9B400',
  },
  links: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 },
  link: {
    border: 'none', background: 'transparent', color: '#8A6D00', fontSize: 12.5,
    cursor: 'pointer', padding: 4,
  },
  skip: {
    width: '100%', marginTop: 10, border: 'none', background: 'transparent', color: '#AAA',
    fontSize: 12, cursor: 'pointer', padding: 6,
  },
};
