// ============================================================
// STACK LAYER: Frontend / Auth Context (product-first)
// The app renders for everyone; nothing is gated at the door.
// Components call `useAuth()` and, for cloud-only actions,
// `requireAuth(reason, onAuthed)` — signed-out users get a
// polished modal explaining why an account helps, and the
// pending action resumes automatically after sign-in.
//
// Also owns two flows that must work app-wide:
//  * PASSWORD_RECOVERY links → force the set-new-password modal
//  * first sign-in → guest projects migrate into the account
// ============================================================
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, saveProject } from '../lib/supabaseClient';
import { migrateLocalProjects } from '../lib/localProjects';
import AuthModal from './AuthModal';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState(null); // null | { reason }
  const [toast, setToast] = useState(null);
  const pendingRef = useRef(null); // action to resume after sign-in

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setModal({ reason: 'recover' });
      if (event === 'SIGNED_IN') {
        // Bring guest work along — silently, then say so.
        migrateLocalProjects(saveProject)
          .then((n) => {
            if (n > 0) flashToast(`✓ ${n} project${n > 1 ? 's' : ''} from this device synced to your account`);
            window.dispatchEvent(new Event('aurigen:projects-changed'));
          })
          .catch(() => {});
        // Resume whatever the user was trying to do when the modal appeared.
        const run = pendingRef.current;
        pendingRef.current = null;
        if (run) setTimeout(run, 50);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function flashToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }

  /**
   * Gate an action behind auth without gating the app.
   * Returns true if already signed in (caller proceeds); otherwise opens
   * the modal, remembers `onAuthed`, and returns false.
   */
  const requireAuth = useCallback((reason = 'generic', onAuthed = null) => {
    if (session) return true;
    pendingRef.current = onAuthed;
    setModal({ reason });
    return false;
  }, [session]);

  const openAuth = useCallback((reason = 'generic') => setModal({ reason }), []);

  return (
    <AuthCtx.Provider value={{ session, user: session?.user ?? null, ready, requireAuth, openAuth }}>
      {children}
      {modal && (
        <AuthModal
          reason={modal.reason}
          onClose={() => { pendingRef.current = null; setModal(null); }}
        />
      )}
      {toast && <div style={T.toast}>{toast}</div>}
    </AuthCtx.Provider>
  );
}

const T = {
  toast: {
    position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 300,
    background: '#1A1A1A', color: '#FFD400', borderRadius: 12, padding: '11px 20px',
    fontSize: 13, fontWeight: 600, boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
};
