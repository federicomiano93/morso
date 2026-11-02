import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryStorage } from '../js/store.js';
import { createSync } from '../js/sync.js';
import { serialize, tombstone } from '../js/model.js';
import { entry, fakeGitHub } from '../testlib/helpers.mjs';

const DAY = '2026-11-02';
const setup = (remote = {}) => {
  const store = createStore(memoryStorage());
  const github = fakeGitHub(remote);
  const sync = createSync({ store, github, today: () => DAY, clock: () => '2026-11-02T12:00:00.000Z' });
  return { store, github, sync };
};
const remoteDay = (github, date = DAY) => JSON.parse(github.files.get(`diary/${date}.json`).text);

test('a new local entry is pushed to diary/<date>.json and the dirty flag clears', async () => {
  const { store, github, sync } = setup();
  store.putEntries(DAY, [entry({ id: 'a' })]);
  assert.deepEqual(store.dirtyDays(), [DAY]);
  const r = await sync.run();
  assert.equal(r.state, 'ok');
  assert.equal(remoteDay(github).entries[0].id, 'a');
  assert.deepEqual(store.dirtyDays(), []);
  assert.equal(store.getMeta().lastSync, '2026-11-02T12:00:00.000Z');
});

test('syncing twice does not rewrite or duplicate anything', async () => {
  const { store, github, sync } = setup();
  store.putEntries(DAY, [entry({ id: 'a' })]);
  await sync.run();
  const putsBefore = github.calls.filter((c) => c[0] === 'put').length;
  await sync.run();
  assert.equal(github.calls.filter((c) => c[0] === 'put').length, putsBefore);
  assert.equal(remoteDay(github).entries.length, 1);
  assert.equal(store.getDay(DAY).entries.length, 1);
});

test('remote and local entries for the same day are merged, not overwritten', async () => {
  const remote = { version: 1, date: DAY, entries: [entry({ id: 'from-claude', source: 'claude' })] };
  const { store, github, sync } = setup({ [`diary/${DAY}.json`]: serialize(remote) });
  store.putEntries(DAY, [entry({ id: 'mine' })]);
  await sync.run();
  const ids = remoteDay(github).entries.map((e) => e.id).sort();
  assert.deepEqual(ids, ['from-claude', 'mine']);
  assert.deepEqual(store.getDay(DAY).entries.map((e) => e.id).sort(), ['from-claude', 'mine']);
});

test('a conflict while pushing is retried against the fresh remote file', async () => {
  const { store, github, sync } = setup({ [`diary/${DAY}.json`]: serialize({ version: 1, date: DAY, entries: [entry({ id: 'r1' })] }) });
  store.putEntries(DAY, [entry({ id: 'mine' })]);
  github.beforePut = (g) => {
    // Someone else writes the file between our read and our write.
    const cur = JSON.parse(g.files.get(`diary/${DAY}.json`).text);
    cur.entries.push(entry({ id: 'r2' }));
    g.seed(`diary/${DAY}.json`, serialize(cur));
  };
  const r = await sync.run();
  assert.equal(r.state, 'ok');
  assert.deepEqual(remoteDay(github).entries.map((e) => e.id).sort(), ['mine', 'r1', 'r2']);
});

test('a deletion travels as a tombstone and wins over the old copy', async () => {
  const { store, github, sync } = setup();
  store.putEntries(DAY, [entry({ id: 'a' })]);
  await sync.run();
  store.putEntries(DAY, [tombstone(entry({ id: 'a' }), '2026-11-02T13:00:00.000Z')]);
  await sync.run();
  assert.equal(remoteDay(github).entries[0].deleted, true);
});

test('a fresh device downloads every day and the library from the repo', async () => {
  const remote = {
    'diary/2026-11-01.json': serialize({ version: 1, date: '2026-11-01', entries: [entry({ id: 'x', date: '2026-11-01' })] }),
    'diary/2026-11-02.json': serialize({ version: 1, date: DAY, entries: [entry({ id: 'y' })] }),
    'library.json': serialize({ version: 1, foods: [{ id: 'f1', name: 'Own food', updatedAt: '1', createdAt: '1' }], meals: [] }),
    'diary/notes.txt': 'ignored',
  };
  const { store, sync } = setup(remote);
  const r = await sync.run();
  assert.equal(r.pulled, 2);
  assert.equal(store.getDay('2026-11-01').entries[0].id, 'x');
  assert.equal(store.getDay(DAY).entries[0].id, 'y');
  assert.equal(store.getLibrary().foods[0].name, 'Own food');
  assert.deepEqual(store.dirtyDays(), []); // pulling never marks anything dirty
});

test('unchanged remote days are not downloaded again', async () => {
  const { store, github, sync } = setup({ [`diary/${DAY}.json`]: serialize({ version: 1, date: DAY, entries: [entry({ id: 'y' })] }) });
  await sync.run();
  const getsBefore = github.calls.filter((c) => c[0] === 'get' && c[1].startsWith('diary/')).length;
  await sync.run();
  assert.equal(github.calls.filter((c) => c[0] === 'get' && c[1].startsWith('diary/')).length, getsBefore);
  assert.equal(store.getDay(DAY).entries.length, 1);
});

test('inbox files are imported once into the diary, then removed', async () => {
  const inbox = JSON.stringify({ entries: [{ date: DAY, meal: 'dinner', name: 'Pizza (estimate)', group: 'other', grams: 350, kcal: 900, protein: 35 }] });
  const { store, github, sync } = setup({ 'inbox/pizza.json': inbox });
  const r = await sync.run();
  assert.equal(r.imported, 1);
  assert.equal(store.getDay(DAY).entries[0].estimate, true);
  assert.equal(store.getDay(DAY).entries[0].source, 'claude');
  assert.equal(github.files.has('inbox/pizza.json'), false);
  assert.equal(remoteDay(github).entries.length, 1);

  // The same file dropped again (same content, same deterministic id) must not duplicate.
  github.seed('inbox/pizza-again.json', inbox);
  const r2 = await sync.run();
  assert.equal(r2.imported, 0);
  assert.equal(store.getDay(DAY).entries.length, 1);
});

test('an inbox entry the user deleted does not come back', async () => {
  const inbox = JSON.stringify([{ date: DAY, meal: 'lunch', name: 'Soup', group: 'vegetables', grams: 300, kcal: 120 }]);
  const { store, github, sync } = setup({ 'inbox/a.json': inbox });
  await sync.run();
  const e = store.getDay(DAY).entries[0];
  store.putEntries(DAY, [tombstone(e, '2026-11-02T14:00:00.000Z')]);
  github.seed('inbox/b.json', inbox);
  await sync.run();
  assert.equal(store.getDay(DAY).entries.length, 1);
  assert.equal(store.getDay(DAY).entries[0].deleted, true);
});

test('an unreadable inbox file is reported and left in place', async () => {
  const { github, sync } = setup({ 'inbox/bad.json': 'not json at all' });
  const r = await sync.run();
  assert.equal(r.imported, 0);
  assert.match(r.importErrors[0], /bad\.json/);
  assert.ok(github.files.has('inbox/bad.json'));
});

test('offline: the error is friendly, local data is untouched and still dirty', async () => {
  const { store, github, sync } = setup();
  store.putEntries(DAY, [entry({ id: 'a' })]);
  github.failNext = Object.assign(new Error('No connection to GitHub.'), { kind: 'network' });
  const r = await sync.run();
  assert.equal(r.state, 'offline');
  assert.deepEqual(store.dirtyDays(), [DAY]);
  assert.equal(store.getDay(DAY).entries.length, 1);
  const again = await sync.run();
  assert.equal(again.state, 'ok');
  assert.equal(remoteDay(github).entries.length, 1);
});

test('a rejected token is reported as an auth problem and nothing is lost', async () => {
  const { store, github, sync } = setup();
  store.putEntries(DAY, [entry({ id: 'a' })]);
  github.failNext = Object.assign(new Error('GitHub rejected the token.'), { kind: 'auth' });
  const r = await sync.run();
  assert.equal(r.state, 'auth');
  assert.deepEqual(store.dirtyDays(), [DAY]);
});

test('a corrupt remote file is never overwritten', async () => {
  const { store, github, sync } = setup({ [`diary/${DAY}.json`]: '{ broken' });
  store.putEntries(DAY, [entry({ id: 'a' })]);
  const r = await sync.run();
  assert.equal(r.state, 'error');
  assert.equal(github.files.get(`diary/${DAY}.json`).text, '{ broken');
  assert.deepEqual(store.dirtyDays(), [DAY]);
});

test('an edit made while a sync is in flight stays queued for the next sync', async () => {
  const { store, github, sync } = setup();
  store.putEntries(DAY, [entry({ id: 'a' })]);
  github.beforePut = () => store.putEntries(DAY, [entry({ id: 'late' })]);
  await sync.run();
  assert.deepEqual(store.dirtyDays(), [DAY]);
  await sync.run();
  assert.deepEqual(store.dirtyDays(), []);
  assert.deepEqual(remoteDay(github).entries.map((e) => e.id).sort(), ['a', 'late']);
});

test('library changes (own foods) sync and merge with the remote library', async () => {
  const remote = { 'library.json': serialize({ version: 1, foods: [{ id: 'r', name: 'Remote', updatedAt: '1', createdAt: '1' }], meals: [] }) };
  const { store, github, sync } = setup(remote);
  store.putFood({ id: 'l', name: 'Local', group: 'other', per100: { kcal: 1 }, updatedAt: '2', createdAt: '2' });
  assert.equal(store.libraryDirty(), true);
  await sync.run();
  const lib = JSON.parse(github.files.get('library.json').text);
  assert.deepEqual(lib.foods.map((f) => f.id).sort(), ['l', 'r']);
  assert.equal(store.libraryDirty(), false);
});
