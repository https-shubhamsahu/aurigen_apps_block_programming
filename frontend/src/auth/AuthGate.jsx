// ============================================================
// STACK LAYER: Frontend / Auth UI
// Gates the app behind a session. Yellow/white brand only.
// ============================================================
import { useEffect, useState } from 'react';
import { supabase, signIn, signUp, sendPasswordReset, updatePassword } from '../lib/supabaseClient';

const styles = {
  // Brand tokens — exclusively yellow + white per brand guidelines.
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#FFFFFF',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  card: {
    width: 'min(400px, 92vw)',
    background: '#FFFFFF',
    border: '3px solid #FFD400',
    borderRadius: 16,
    padding: '40px 32px',
  },
  logo: { fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 },
  logoDot: { color: '#FFD400' },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginTop: 12,
    border: '2px solid #FFF3B0', borderRadius: 10, fontSize: 15, outlineColor: '#FFD400',
  },
  button: {
    width: '100%', marginTop: 20, padding: '13px 0', border: 'none', borderRadius: 10,
    background: '#FFD400', color: '#1A1A1A', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  toggle: { marginTop: 16, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' },
  error: { marginTop: 14, padding: '10px 12px', background: '#FFF9DB', borderRadius: 8, fontSize: 13 },
};

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot' | 'recover'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    // Keep React state in sync with token refresh / sign-out in other tabs.
    // A recovery link signs the user in with a special event — intercept it
    // and ask for a new password before letting them into the app.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recover');
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else if (mode === 'signup') {
        await signUp(email, password);
        setError('Check your inbox to confirm your email, then sign in.');
        setMode('signin');
      } else if (mode === 'forgot') {
        await sendPasswordReset(email);
        setError('Password reset link sent — check your inbox.');
        setMode('signin');
      } else if (mode === 'recover') {
        if (password.length < 8) throw new Error('Use at least 8 characters.');
        await updatePassword(password);
        setPassword('');
        setMode('signin');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;                            // avoid login flash while session restores
  if (session && mode !== 'recover') return children; // authenticated → render the app

  const copy = {
    signin: { sub: 'Sign in to open your workspace.', cta: 'Sign in' },
    signup: { sub: 'Create your student account.', cta: 'Create account' },
    forgot: { sub: 'We will email you a reset link.', cta: 'Send reset link' },
    recover: { sub: 'Choose a new password to finish resetting.', cta: 'Set new password' },
  }[mode];

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.logo}>Aurigen<span style={styles.logoDot}>.</span></h1>
        <p style={{ fontSize: 14, color: '#555' }}>{copy.sub}</p>

        {mode !== 'recover' && (
          <input style={styles.input} type="email" placeholder="Email"
                 value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        )}
        {mode !== 'forgot' && (
          <input style={styles.input} type="password"
                 placeholder={mode === 'recover' ? 'New password' : 'Password'}
                 value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                 onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
        )}

        {error && <div style={styles.error}>{error}</div>}

        <button style={{ ...styles.button, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={handleSubmit}>
          {busy ? 'One moment…' : copy.cta}
        </button>

        {mode !== 'recover' && (
          <>
            <button style={styles.toggle} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}>
              {mode === 'signin' ? 'New here? Create an account' : 'Already registered? Sign in'}
            </button>
            {mode === 'signin' && (
              <button style={styles.toggle} onClick={() => { setMode('forgot'); setError(null); }}>
                Forgot password?
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
