// ============================================================
// STACK LAYER: Frontend / Guest Persistence
// localStorage-backed project store with the same row shape as
// the Supabase `projects` table, so the editor and Home screen
// treat guest and cloud projects identically. Guest ids carry a
// `local_` prefix — that's the only discriminator anyone needs.
// ============================================================
const KEY = 'aurigen.projects.v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  localStorage.setItem(KEY, JSON.stringify(rows));
}

export const isLocalId = (id) => typeof id === 'string' && id.startsWith('local_');

export function listLocalProjects() {
  return readAll().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function loadLocalProject(id) {
  const row = readAll().find((r) => r.id === id);
  if (!row) throw new Error('Project not found on this device.');
  return row;
}

export function saveLocalProject({ id, title, workspaceXml, generatedCpp, boardTarget }) {
  const rows = readAll();
  const now = new Date().toISOString();
  if (id) {
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) throw new Error('Project not found on this device.');
    rows[i] = { ...rows[i], title, workspace_xml: workspaceXml, generated_cpp: generatedCpp, board_target: boardTarget, updated_at: now };
    writeAll(rows);
    return rows[i];
  }
  const row = {
    id: `local_${crypto.randomUUID()}`,
    title,
    board_target: boardTarget,
    workspace_xml: workspaceXml,
    generated_cpp: generatedCpp,
    created_at: now,
    updated_at: now,
  };
  rows.push(row);
  writeAll(rows);
  return row;
}

export function deleteLocalProject(id) {
  writeAll(readAll().filter((r) => r.id !== id));
}

/**
 * On sign-in, push everything made as a guest into the user's account,
 * then clear the device copy. Returns how many projects moved.
 */
export async function migrateLocalProjects(saveToCloud) {
  const rows = readAll();
  if (rows.length === 0) return 0;
  let moved = 0;
  const remaining = [];
  for (const r of rows) {
    try {
      await saveToCloud({
        id: null,
        title: r.title,
        workspaceXml: r.workspace_xml,
        generatedCpp: r.generated_cpp,
        boardTarget: r.board_target,
      });
      moved += 1;
    } catch {
      remaining.push(r); // keep anything that failed; retry next sign-in
    }
  }
  writeAll(remaining);
  return moved;
}
