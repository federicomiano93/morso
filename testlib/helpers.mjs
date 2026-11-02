// In-memory stand-in for the GitHub client, with the same sha-based conflict behaviour.
let counter = 0;

export function fakeGitHub(initial = {}) {
  const files = new Map(); // path -> { text, sha }
  const calls = [];
  const api = {
    files,
    calls,
    failNext: null, // set to an error object to throw on the next call
    beforePut: null, // hook run before the next put, e.g. to simulate a concurrent edit
    seed(path, text) {
      files.set(path, { text, sha: `sha${++counter}` });
    },
    _maybeFail() {
      if (api.failNext) {
        const e = api.failNext;
        api.failNext = null;
        throw e;
      }
    },
    async getFile(path) {
      api._maybeFail();
      calls.push(['get', path]);
      const f = files.get(path);
      return f ? { text: f.text, sha: f.sha } : null;
    },
    async putFile(path, text, sha, message) {
      api._maybeFail();
      calls.push(['put', path]);
      if (api.beforePut) {
        const hook = api.beforePut;
        api.beforePut = null;
        hook(api);
      }
      const cur = files.get(path);
      if ((cur && cur.sha !== sha) || (!cur && sha)) {
        const e = new Error('conflict');
        e.kind = 'conflict';
        throw e;
      }
      const next = { text, sha: `sha${++counter}`, message };
      files.set(path, next);
      return next.sha;
    },
    async deleteFile(path, sha) {
      api._maybeFail();
      calls.push(['delete', path]);
      const cur = files.get(path);
      if (!cur || cur.sha !== sha) {
        const e = new Error('conflict');
        e.kind = 'conflict';
        throw e;
      }
      files.delete(path);
    },
    async listDir(dir) {
      api._maybeFail();
      calls.push(['list', dir]);
      return [...files.entries()]
        .filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map(([p, f]) => ({ name: p.split('/').pop(), path: p, sha: f.sha }));
    },
  };
  for (const [p, t] of Object.entries(initial)) api.seed(p, t);
  return api;
}

export const entry = (over = {}) => ({
  id: 'e1',
  type: 'food',
  date: '2026-11-02',
  meal: 'lunch',
  foodId: null,
  name: 'Apple',
  group: 'fruit',
  grams: 180,
  kcal: 94,
  protein: 0.5,
  carbs: 25,
  fat: 0.4,
  estimate: false,
  source: 'app',
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  ...over,
});
