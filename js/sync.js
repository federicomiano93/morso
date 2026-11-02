// Background sync between the local store and the private data repo.
// Local changes are already saved before this runs; a failure here never loses or blocks anything.
//
// Layout of the data repo:
//   diary/YYYY-MM-DD.json   one file per day: { version, date, entries: [...] } (food now, workouts later)
//   library.json            { version, foods: [...], meals: [...] }
//   inbox/*.json            entries proposed by Claude; imported on open, then removed

import { dateStr, mergeDay, mergeLibrary, nowIso, serialize } from './model.js';
import { parseClaudeBlock } from './claude-import.js';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const MAX_TRIES = 3;

class DataError extends Error {
  constructor(message) {
    super(message);
    this.kind = 'data';
  }
}

function parseRemote(file, what) {
  if (!file) return null;
  try {
    return JSON.parse(file.text);
  } catch {
    throw new DataError(`${what} on GitHub is not valid JSON, so Morso left it untouched.`);
  }
}

export function createSync({ store, github, today = () => dateStr(), clock = () => nowIso() }) {
  let running = false;
  let again = false;

  async function mergeAndPush(path, { read, save, merge, clearDirty, message, dirty }) {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const remoteFile = await github.getFile(path);
      const remote = parseRemote(remoteFile, path);
      const local = read();
      const merged = merge(local, remote);
      const remoteSame = remoteFile && serialize(merged) === remoteFile.text;
      let sha = remoteFile ? remoteFile.sha : null;
      if (!remoteSame && dirty) {
        try {
          sha = await github.putFile(path, serialize(merged), sha, message);
        } catch (err) {
          if (err.kind === 'conflict' && attempt < MAX_TRIES - 1) continue;
          throw err;
        }
      }
      // The user may have edited while we were talking to GitHub: keep the dirty flag then.
      const latest = read();
      if (serialize(latest) === serialize(local)) {
        save(merged, { dirty: false });
        if (dirty) clearDirty();
      } else {
        save(merge(latest, merged), { dirty: true });
      }
      if (sha) store.setSha(path, sha);
      return true;
    }
    return false;
  }

  const syncDay = (date, dirty) =>
    mergeAndPush(`diary/${date}.json`, {
      read: () => store.getDay(date),
      save: (d, o) => store.saveDay(d, o),
      merge: mergeDay,
      clearDirty: () => store.clearDirtyDay(date),
      message: `diary: ${date}`,
      dirty,
    });

  const syncLibrary = (dirty) =>
    mergeAndPush('library.json', {
      read: () => store.getLibrary(),
      save: (l, o) => store.saveLibrary(l, o),
      merge: mergeLibrary,
      clearDirty: () => store.clearLibraryDirty(),
      message: 'library: foods and saved meals',
      dirty,
    });

  async function importInbox(result) {
    const files = (await github.listDir('inbox')).filter((f) => /\.json$/i.test(f.name));
    for (const f of files) {
      const file = await github.getFile(f.path);
      if (!file) continue;
      const { entries, rejected, errors } = parseClaudeBlock(file.text, { defaultDate: today(), now: clock() });
      if (!entries.length) {
        result.importErrors.push(`${f.name}: ${errors[0] || 'nothing to import.'}`);
        continue; // left in place so Federico can see and fix it
      }
      for (const e of entries) {
        const existing = store.getDay(e.date).entries.some((x) => x.id === e.id);
        if (existing) continue; // already imported (or deleted on purpose): never duplicate or resurrect
        if (!store.putEntries(e.date, [e])) throw new DataError('This phone has no room left to save the import.');
        result.imported += 1;
      }
      errors.forEach((m) => result.importErrors.push(`${f.name}: ${m}`));
      if (rejected.length) {
        // Keep what could not be imported in the file, so nothing Claude proposed disappears unseen.
        await github.putFile(f.path, serialize({ entries: rejected }), file.sha, `inbox: ${rejected.length} item(s) of ${f.name} need fixing`);
      } else {
        await github.deleteFile(f.path, file.sha, `inbox: imported ${f.name}`);
      }
    }
  }

  async function pullAndPush(result) {
    const remoteDays = (await github.listDir('diary')).filter((f) => DAY_FILE.test(f.name));
    const known = new Set();
    const dirty = new Set(store.dirtyDays());
    for (const f of remoteDays) {
      const date = DAY_FILE.exec(f.name)[1];
      known.add(date);
      if (dirty.has(date)) {
        await syncDay(date, true);
        result.pushed += 1;
      } else if (store.getSha(f.path) !== f.sha) {
        await syncDay(date, false);
        result.pulled += 1;
      }
    }
    for (const date of dirty) {
      if (known.has(date)) continue;
      await syncDay(date, true);
      result.pushed += 1;
    }
  }

  async function runOnce() {
    const result = { state: 'ok', message: '', imported: 0, pulled: 0, pushed: 0, importErrors: [] };
    try {
      await importInbox(result);
      await syncLibrary(store.libraryDirty());
      await pullAndPush(result);
      store.markSynced(clock());
    } catch (err) {
      const kind = err && err.kind;
      result.state = kind === 'auth' || kind === 'forbidden' ? 'auth' : kind === 'network' ? 'offline' : 'error';
      // Messages written for people; they never contain the token.
      result.message = err && err.message ? err.message : 'Sync failed. Your changes are safe on this phone.';
    }
    return result;
  }

  return {
    /** Runs one sync; calls made while one is running are folded into a single follow-up run. */
    async run() {
      if (running) {
        again = true;
        return null;
      }
      running = true;
      let result;
      try {
        do {
          again = false;
          result = await runOnce();
        } while (again && result.state === 'ok');
      } finally {
        running = false;
      }
      return result;
    },
    isRunning: () => running,
  };
}
