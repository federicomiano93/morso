import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, fromBase64, toBase64, GitHubError } from '../js/github.js';
import { parseClaudeBlock } from '../js/claude-import.js';
import { guessGroup, offToFood, searchOff } from '../js/off.js';
import { createStore, memoryStorage } from '../js/store.js';
import { STARTER_FOODS } from '../js/starter-foods.js';
import { isGroup, validateFood } from '../js/model.js';
import { entry } from '../testlib/helpers.mjs';

// ---------- github client ----------

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

test('base64 round-trips UTF-8 text', () => {
  const s = 'Crème fraîche – 🍎 ' + 'x'.repeat(100000);
  assert.equal(fromBase64(toBase64(s)), s);
});

test('client sends the token only in the Authorization header, never in the URL', async () => {
  let seen;
  const gh = createGitHub({
    token: 'SECRET-TOKEN',
    repo: 'o/r',
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return reply(200, { type: 'file', content: toBase64('hello'), sha: 's1' });
    },
  });
  const f = await gh.getFile('diary/2026-11-02.json');
  assert.deepEqual(f, { text: 'hello', sha: 's1' });
  assert.ok(!seen.url.includes('SECRET-TOKEN'));
  assert.equal(seen.init.headers.Authorization, 'Bearer SECRET-TOKEN');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.url, 'https://api.github.com/repos/o/r/contents/diary/2026-11-02.json');
});

test('putFile sends base64 content and sha, and returns the new sha', async () => {
  let body;
  const gh = createGitHub({
    token: 't', repo: 'o/r',
    fetchImpl: async (_u, init) => {
      body = JSON.parse(init.body);
      return reply(200, { content: { sha: 'new' } });
    },
  });
  assert.equal(await gh.putFile('library.json', 'abc', 'old', 'msg'), 'new');
  assert.equal(fromBase64(body.content), 'abc');
  assert.equal(body.sha, 'old');
  await gh.putFile('library.json', 'abc', null, 'msg');
  assert.equal('sha' in body, false);
});

test('404 on a file or folder means "not there yet", not an error', async () => {
  const gh = createGitHub({ token: 't', repo: 'o/r', fetchImpl: async () => reply(404, { message: 'Not Found' }) });
  assert.equal(await gh.getFile('x.json'), null);
  assert.deepEqual(await gh.listDir('inbox'), []);
});

test('errors are classified into friendly kinds without leaking the token', async () => {
  const kinds = [
    [401, {}, {}, 'auth'],
    [403, { message: 'Resource not accessible by personal access token' }, {}, 'forbidden'],
    [403, { message: 'API rate limit exceeded' }, {}, 'ratelimit'],
    [403, {}, { 'x-ratelimit-remaining': '0' }, 'ratelimit'],
    [429, {}, {}, 'ratelimit'],
    [409, {}, {}, 'conflict'],
    [422, {}, {}, 'conflict'],
    [503, {}, {}, 'server'],
  ];
  for (const [status, body, headers, kind] of kinds) {
    const gh = createGitHub({ token: 'SECRET-TOKEN', repo: 'o/r', fetchImpl: async () => reply(status, body, headers) });
    await assert.rejects(gh.putFile('a', 'b', null, 'm'), (e) => {
      assert.ok(e instanceof GitHubError);
      assert.equal(e.kind, kind, `status ${status}`);
      assert.ok(!e.message.includes('SECRET-TOKEN'));
      return true;
    });
  }
});

test('a network failure becomes a friendly "network" error', async () => {
  const gh = createGitHub({ token: 't', repo: 'o/r', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(gh.listDir('diary'), (e) => e.kind === 'network' && /saved on this phone/.test(e.message));
});

test('check() fails clearly when the token can read but not write', async () => {
  const gh = createGitHub({ token: 't', repo: 'o/r', fetchImpl: async () => reply(200, { full_name: 'o/r', permissions: { push: false } }) });
  await assert.rejects(gh.check(), (e) => e.kind === 'forbidden');
  const ok = createGitHub({ token: 't', repo: 'o/r', fetchImpl: async () => reply(200, { full_name: 'o/r', permissions: { push: true } }) });
  assert.equal(await ok.check(), 'o/r');
});

// ---------- paste from Claude ----------

const NOW = '2026-11-02T12:00:00.000Z';
const item = { date: '2026-11-02', meal: 'Lunch', name: 'Chicken salad', group: 'meat', grams: 300, kcal: 420, protein: 38 };

test('parses a JSON array, an {entries} object and a fenced block', () => {
  for (const text of [JSON.stringify([item]), JSON.stringify({ entries: [item] }), '```json\n' + JSON.stringify([item]) + '\n```', 'Here you go:\n```\n' + JSON.stringify([item]) + '\n```']) {
    const r = parseClaudeBlock(text, { defaultDate: '2026-11-02', now: NOW });
    assert.deepEqual(r.errors, []);
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].meal, 'lunch');
    assert.equal(r.entries[0].estimate, true);
    assert.equal(r.entries[0].source, 'claude');
    assert.equal(r.entries[0].protein, 38);
  }
});

test('the same pasted item always gets the same id, so pasting twice cannot duplicate', () => {
  const a = parseClaudeBlock(JSON.stringify([item]), { now: NOW }).entries[0];
  const b = parseClaudeBlock(JSON.stringify([item]), { now: '2030-01-01T00:00:00Z' }).entries[0];
  assert.equal(a.id, b.id);
  assert.equal(parseClaudeBlock(JSON.stringify([{ ...item, id: 'mine' }]), { now: NOW }).entries[0].id, 'mine');
});

test('identical items in one block stay separate entries, and re-parsing gives the same ids', () => {
  const block = JSON.stringify([item, item]);
  const a = parseClaudeBlock(block, { now: NOW }).entries;
  const b = parseClaudeBlock(block, { now: NOW }).entries;
  assert.equal(a.length, 2);
  assert.notEqual(a[0].id, a[1].id);
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
});

test('rejected raw items are returned so a file can keep them', () => {
  const bad = { ...item, grams: 0 };
  const r = parseClaudeBlock(JSON.stringify([item, bad]), { now: NOW });
  assert.deepEqual(r.rejected, [bad]);
});

test('bad items are rejected one by one with plain messages; good ones still import', () => {
  const r = parseClaudeBlock(JSON.stringify([item, { ...item, grams: 0 }, { ...item, meal: 'brunch' }, { ...item, date: '2026-02-30' }, { ...item, name: '' }, { ...item, kcal: 'lots' }, { ...item, type: 'workout' }, 5]), { now: NOW });
  assert.equal(r.entries.length, 1);
  assert.equal(r.errors.length, 7);
});

test('unknown group falls back to other; missing date uses the default; garbage input is explained', () => {
  const { date, ...noDate } = item;
  const r = parseClaudeBlock(JSON.stringify([{ ...noDate, group: 'mystery' }]), { defaultDate: '2026-11-05', now: NOW });
  assert.equal(r.entries[0].group, 'other');
  assert.equal(r.entries[0].date, '2026-11-05');
  assert.match(parseClaudeBlock('hello', {}).errors[0], /not valid JSON/);
  assert.match(parseClaudeBlock('{"a":1}', {}).errors[0], /No entries/);
  assert.match(parseClaudeBlock('[]', {}).errors[0], /empty/);
  assert.equal(parseClaudeBlock('', {}).entries.length, 0);
});

// ---------- Open Food Facts ----------

test('offToFood converts nutriments, falls back from kJ, and flags missing values', () => {
  const f = offToFood({ product_name: 'Muesli', brands: 'Brand A, Brand B', nutriments: { 'energy-kcal_100g': 370, proteins_100g: 9, carbohydrates_100g: 60, fat_100g: 7 }, serving_quantity: '40', categories_tags: ['en:breakfast-cereals'], code: '123' });
  assert.equal(f.name, 'Muesli (Brand A)');
  assert.deepEqual(f.per100, { kcal: 370, protein: 9, carbs: 60, fat: 7 });
  assert.equal(f.servingG, 40);
  assert.equal(f.group, 'starches');
  assert.equal(f.incomplete, false);
  assert.equal(f.source, 'off');
  assert.equal(f.id, 'off-123');
  assert.equal(offToFood({ product_name: 'Same', code: '123' }).id, 'off-123');

  const kj = offToFood({ product_name: 'X', nutriments: { energy_100g: 418.4 } });
  assert.equal(kj.per100.kcal, 100);
  assert.equal(kj.incomplete, true);
  assert.equal(offToFood({ product_name: '  ' }), null);
});

test('guessGroup maps category tags and defaults to other', () => {
  assert.equal(guessGroup(['en:fresh-fruits']), 'fruit');
  assert.equal(guessGroup(['en:legumes-and-their-products']), 'legumes');
  assert.equal(guessGroup(['en:cheeses']), 'dairy');
  assert.equal(guessGroup([]), 'other');
  assert.equal(guessGroup(undefined), 'other');
});

test('searchOff returns foods, and turns failures into friendly errors', async () => {
  const ok = await searchOff('banana', { fetchImpl: async () => reply(200, { products: [{ product_name: 'Banana', nutriments: {} }, { product_name: '' }] }) });
  assert.equal(ok.length, 1);
  await assert.rejects(searchOff('x', { fetchImpl: async () => reply(503, {}) }), /not answering/);
  await assert.rejects(searchOff('x', { fetchImpl: async () => { throw new TypeError('offline'); } }), /Could not reach/);
  assert.deepEqual(await searchOff('  ', { fetchImpl: async () => { throw new Error('should not be called'); } }), []);
});

// ---------- local store ----------

test('the store saves days locally at once and tracks dirty days', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.getDay('2026-11-02').entries.length, 0);
  assert.equal(store.putEntries('2026-11-02', [entry({ id: 'a' })]), true);
  store.putEntries('2026-11-02', [entry({ id: 'a', name: 'Changed' })]);
  assert.equal(store.getDay('2026-11-02').entries.length, 1);
  assert.equal(store.getDay('2026-11-02').entries[0].name, 'Changed');
  assert.deepEqual(store.dirtyDays(), ['2026-11-02']);
  store.clearDirtyDay('2026-11-02');
  assert.deepEqual(store.dirtyDays(), []);
});

test('corrupt or full storage never crashes the app', () => {
  const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const store = createStore(bad);
  assert.deepEqual(store.getDay('2026-11-02').entries, []);
  assert.equal(store.getLibrary().foods.length, 0);
  assert.equal(store.putEntries('2026-11-02', [entry()]), false);
  assert.equal(store.getSettings().repo, 'federicomiano93/morso-data');
});

test('seeding adds starter foods once and keeps the user\'s own', () => {
  const store = createStore(memoryStorage());
  store.putFood({ id: 'mine', name: 'Mine', updatedAt: '9', createdAt: '9' });
  store.seedFoods(STARTER_FOODS);
  const n = store.getLibrary().foods.length;
  assert.equal(n, STARTER_FOODS.length + 1);
  store.seedFoods(STARTER_FOODS);
  assert.equal(store.getLibrary().foods.length, n);
});

test('token is stored separately and can be removed', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.getToken(), '');
  store.setToken('abc');
  assert.equal(store.getToken(), 'abc');
  assert.ok(!JSON.stringify(store.getSettings()).includes('abc'));
  store.setToken('');
  assert.equal(store.getToken(), '');
});

test('every starter food is valid, has a known group and a unique id', () => {
  const ids = new Set();
  for (const f of STARTER_FOODS) {
    assert.deepEqual(validateFood(f), {}, f.name);
    assert.ok(isGroup(f.group));
    assert.ok(!ids.has(f.id));
    ids.add(f.id);
  }
});
