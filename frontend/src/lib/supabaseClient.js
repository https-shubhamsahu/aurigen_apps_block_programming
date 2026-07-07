// ============================================================
// STACK LAYER: Frontend / Auth & Persistence
// Supabase client singleton + thin auth/project helpers.
// ============================================================
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly at boot rather than mysteriously at first query.
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,      // survive refresh — students close tabs constantly
    autoRefreshToken: true,
    detectSessionInUrl: true,  // handles email-confirmation redirects
  },
});

// ---------- Auth helpers ----------

export async function signUp(email, password) {
  // Without this, the confirmation email links back to whatever the
  // project's Auth "Site URL" happens to be set to (often a stale
  // localhost default) instead of wherever the app is actually running.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw normalizeAuthError(error);
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw normalizeAuthError(error);
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Emails a recovery link; the link lands back on the app with a recovery session. */
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw normalizeAuthError(error);
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw normalizeAuthError(error);
}

/** Returns the current JWT (needed by POST /api/compile) or null. */
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Map raw Supabase errors to student-friendly copy.
function normalizeAuthError(error) {
  const table = {
    'Invalid login credentials': 'Email or password is incorrect.',
    'User already registered': 'An account with this email already exists.',
  };
  return new Error(table[error.message] ?? error.message);
}

// ---------- Project persistence (RLS enforces ownership) ----------

export async function saveProject({ id, title, workspaceXml, generatedCpp, boardTarget }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const row = {
    user_id: user.id,
    title,
    board_target: boardTarget,
    workspace_xml: workspaceXml,
    generated_cpp: generatedCpp,
  };

  const query = id
    ? supabase.from('projects').update(row).eq('id', id).select().single()
    : supabase.from('projects').insert(row).select().single();

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, board_target, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadProject(id) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
