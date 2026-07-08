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
import ModalShell from '../design/ModalShell';
import Spinner from '../design/Spinner';
import { color, space, radius, font, shadow, motion } from '../design/tokens';

const REASONS = {
  generic:  { title: 'Welcome back', benefit: 'Sign in to sync projects, compile in the cloud, and pick up where you left off on any device.' },
  compile:  { title: 'Almost there — one free account', benefit: 'Compiling runs on our cloud build servers (real arduino-cli, real firmware). A free account keeps the service fair for everyone.' },
  cloud:    { title: 'Save to your account', benefit: 'Projects saved to your account open on any device and never leave your browser otherwise.' },
  recover:  { title: 'Set a new password', benefit: 'Choose a new password to finish resetting your account.' },
};

function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export default function AuthModal({ reason = 'generic', onClose }) {
  const { session } = useAuth();
  const [mode, setMode] = useState(reason === 'recover' ? 'recover' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Once a session exists (and we're not mid-recovery), the job is done.
  useEffect(() => {
    if (session && mode !== 'recover') onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const copy = REASONS[mode === 'recover' ? 'recover' : reason] ?? REASONS.generic;

  const emailError = touched && mode !== 'recover' && !validEmail(email) ? 'Enter a valid email address.' : null;
  const passwordError = touched && mode === 'recover' && password.length > 0 && password.length < 8
    ? 'Use at least 8 characters.' : null;
  const canSubmit = mode === 'forgot' ? validEmail(email)
    : mode === 'recover' ? password.length >= 8
    : validEmail(email) && password.length > 0;

  async function submit() {
    setTouched(true);
    if (!canSubmit) return;
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
        await updatePassword(password);
        onClose();
      }
    } catch (e) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setNotice(null);
    setTouched(false);
  }

  const cta = { signin: 'Sign in', signup: 'Create free account', forgot: 'Send reset link', recover: 'Set new password' }[mode];

  return (
    <ModalShell onClose={onClose} dismissible={mode !== 'recover'} labelledBy="auth-modal-title" width={400}>
      {mode !== 'recover' && (
        <button style={S.close} onClick={onClose} title="Keep building without an account" aria-label="Close">✕</button>
      )}

      <div style={S.brandRow}>
        <span style={S.brand}>Aurigen<span style={{ color: '#B08D00' }}>.</span></span>
      </div>
      <h2 id="auth-modal-title" style={S.title}>{mode === 'signup' ? 'Create your free account' : copy.title}</h2>
      <p style={S.benefit}>{copy.benefit}</p>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {mode !== 'recover' && (
          <div style={S.field}>
            <label style={S.fieldLabel} htmlFor="auth-email">Email</label>
            <input
              id="auth-email" style={{ ...S.input, ...(emailError ? S.inputError : {}) }}
              type="email" value={email} autoFocus autoComplete="email"
              aria-invalid={!!emailError} aria-describedby={emailError ? 'auth-email-error' : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {emailError && <div id="auth-email-error" style={S.fieldError} role="alert">{emailError}</div>}
          </div>
        )}
        {mode !== 'forgot' && (
          <div style={S.field}>
            <label style={S.fieldLabel} htmlFor="auth-password">
              {mode === 'recover' ? 'New password' : 'Password'}
            </label>
            <div style={S.passwordRow}>
              <input
                id="auth-password" style={{ ...S.input, paddingRight: 44, ...(passwordError ? S.inputError : {}) }}
                type={showPassword ? 'text' : 'password'}
                placeholder={mode === 'recover' ? '8+ characters' : undefined}
                value={password}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                aria-invalid={!!passwordError} aria-describedby={passwordError ? 'auth-password-error' : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button" style={S.showToggle} onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'} tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {passwordError && <div id="auth-password-error" style={S.fieldError} role="alert">{passwordError}</div>}
          </div>
        )}

        {notice && (
          <div style={{ ...S.notice, ...(notice.ok ? S.noticeOk : S.noticeErr) }} role={notice.ok ? 'status' : 'alert'}>
            {notice.text}
          </div>
        )}

        <button type="submit" style={{ ...S.cta, opacity: busy ? 0.75 : 1 }} disabled={busy}>
          {busy && <Spinner size={15} />}
          {busy ? 'One moment…' : cta}
        </button>
      </form>

      {mode !== 'recover' && (
        <div style={S.links}>
          <button style={S.link} onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'New here? Create an account' : 'Already registered? Sign in'}
          </button>
          {mode === 'signin' && (
            <button style={S.link} onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          )}
        </div>
      )}

      {mode !== 'recover' && reason !== 'generic' && (
        <button style={S.skip} onClick={onClose}>← Keep building without an account</button>
      )}
    </ModalShell>
  );
}

const S = {
  close: {
    position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: radius.sm,
    border: 'none', background: color.surfaceAlt, color: color.textMuted, cursor: 'pointer', fontSize: font.sm,
  },
  brandRow: { marginBottom: space.sm },
  brand: { fontWeight: 800, fontSize: font.lg, background: color.brand, color: color.brandInk, borderRadius: radius.sm, padding: '4px 10px' },
  title: { margin: '4px 0 6px', fontSize: font.xl, letterSpacing: '-0.01em', color: color.text },
  benefit: { margin: `0 0 ${space.lg}px`, fontSize: font.sm, color: color.textSecondary, lineHeight: 1.5 },
  field: { marginBottom: space.md },
  fieldLabel: { display: 'block', fontSize: font.xs, fontWeight: 600, color: color.textMuted, marginBottom: 4 },
  passwordRow: { position: 'relative' },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: `2px solid ${color.border}`,
    borderRadius: radius.md, fontSize: font.md, background: color.surface, color: color.text,
    transition: `border-color ${motion.fast}`,
  },
  inputError: { borderColor: color.danger },
  showToggle: {
    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', border: 'none',
    background: 'transparent', cursor: 'pointer', fontSize: font.md, width: 36, height: 36, borderRadius: radius.sm,
  },
  fieldError: { fontSize: font.xs, color: color.danger, marginTop: 4 },
  notice: { borderRadius: radius.md, padding: '9px 12px', fontSize: font.sm, marginBottom: space.md },
  noticeOk: { background: color.successBg, color: color.successInk },
  noticeErr: { background: color.dangerBg, color: color.dangerInk },
  cta: {
    width: '100%', border: 'none', borderRadius: radius.lg, padding: '13px 0', background: color.brand,
    color: color.brandInk, fontWeight: 800, fontSize: font.md, cursor: 'pointer', boxShadow: shadow.brandBtn,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
  links: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: space.md },
  link: {
    border: 'none', background: 'transparent', color: color.brandTintInk, fontSize: font.sm,
    cursor: 'pointer', padding: 4, textAlign: 'left',
  },
  skip: {
    width: '100%', marginTop: space.sm, border: 'none', background: 'transparent', color: color.textMuted,
    fontSize: font.xs, cursor: 'pointer', padding: 6,
  },
};
