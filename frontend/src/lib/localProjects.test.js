import { describe, it, expect, beforeEach } from 'vitest';
import {
  listLocalProjects, loadLocalProject, saveLocalProject,
  deleteLocalProject, migrateLocalProjects, isLocalId,
} from './localProjects.js';

// Minimal localStorage shim for the node environment.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});

const draft = { title: 'Blink', workspaceXml: '<xml/>', generatedCpp: '// c++', boardTarget: 'arduino_uno_r3' };

describe('guest project store', () => {
  it('inserts with a local_ id and round-trips through load', () => {
    const row = saveLocalProject({ id: null, ...draft });
    expect(isLocalId(row.id)).toBe(true);
    expect(loadLocalProject(row.id).title).toBe('Blink');
  });

  it('updates in place and bumps updated_at ordering', async () => {
    const a = saveLocalProject({ id: null, ...draft, title: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    saveLocalProject({ id: null, ...draft, title: 'B' });
    await new Promise((r) => setTimeout(r, 5));
    saveLocalProject({ id: a.id, ...draft, title: 'A2' });
    const titles = listLocalProjects().map((p) => p.title);
    expect(titles[0]).toBe('A2'); // most recently updated first
    expect(titles).toContain('B');
  });

  it('deletes', () => {
    const row = saveLocalProject({ id: null, ...draft });
    deleteLocalProject(row.id);
    expect(listLocalProjects()).toHaveLength(0);
  });

  it('migrates everything to the cloud and clears the device copy', async () => {
    saveLocalProject({ id: null, ...draft, title: 'one' });
    saveLocalProject({ id: null, ...draft, title: 'two' });
    const pushed = [];
    const moved = await migrateLocalProjects(async (p) => pushed.push(p.title));
    expect(moved).toBe(2);
    expect(pushed.sort()).toEqual(['one', 'two']);
    expect(listLocalProjects()).toHaveLength(0);
  });

  it('keeps rows whose cloud insert failed, for the next retry', async () => {
    saveLocalProject({ id: null, ...draft, title: 'good' });
    saveLocalProject({ id: null, ...draft, title: 'bad' });
    const moved = await migrateLocalProjects(async (p) => {
      if (p.title === 'bad') throw new Error('network');
    });
    expect(moved).toBe(1);
    expect(listLocalProjects().map((p) => p.title)).toEqual(['bad']);
  });
});
