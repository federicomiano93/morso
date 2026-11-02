// Local-first storage. Everything the user does is saved here first, at once; syncing is separate.
// `storage` is anything with getItem/setItem/removeItem (localStorage in the app, a Map in tests).

import { emptyDay, emptyLibrary, mergeRecords, upsert } from './model.js';

export const DEFAULT_REPO = 'federicomiano93/morso-data';

const K = {
  day: (date) => `morso:day:${date}`,
  library: 'morso:library',
  meta: 'morso:meta',
  settings: 'morso:settings',
  token: 'morso:token',
};

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

export function createStore(storage) {
  const listeners = new Set();

  function read(key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : fallback;
    } catch {
      // Unreadable or blocked storage: behave as if empty rather than crash.
      return fallback;
    }
  }

  function write(key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  const emit = () => listeners.forEach((fn) => fn());

  const metaDefaults = () => ({ dirtyDays: [], libraryDirty: false, shas: {}, lastSync: null, seeded: false });
  const getMeta = () => ({ ...metaDefaults(), ...read(K.meta, {}) });
  const setMeta = (m) => write(K.meta, m);

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // ----- diary days -----
    getDay(date) {
      const d = read(K.day(date), null);
      return d && Array.isArray(d.entries) ? d : emptyDay(date);
    },

    /** Save a day. `dirty` (default) queues it for the next sync. Returns false if storage is full. */
    saveDay(day, { dirty = true } = {}) {
      const ok = write(K.day(day.date), day);
      if (ok && dirty) {
        const m = getMeta();
        if (!m.dirtyDays.includes(day.date)) m.dirtyDays.push(day.date);
        setMeta(m);
      }
      if (ok) emit();
      return ok;
    },

    /** Add or replace entries (by id) in one day. */
    putEntries(date, entries) {
      let day = this.getDay(date);
      for (const e of entries) day = { ...day, entries: upsert(day.entries, e) };
      return this.saveDay(day);
    },

    // ----- library (foods and saved meals) -----
    getLibrary() {
      const l = read(K.library, null);
      return l && Array.isArray(l.foods) ? { ...emptyLibrary(), ...l } : emptyLibrary();
    },

    saveLibrary(lib, { dirty = true } = {}) {
      const ok = write(K.library, lib);
      if (ok && dirty) {
        const m = getMeta();
        m.libraryDirty = true;
        setMeta(m);
      }
      if (ok) emit();
      return ok;
    },

    putFood(food) {
      const lib = this.getLibrary();
      return this.saveLibrary({ ...lib, foods: upsert(lib.foods, food) });
    },

    putMeal(meal) {
      const lib = this.getLibrary();
      return this.saveLibrary({ ...lib, meals: upsert(lib.meals, meal) });
    },

    /** Add starter foods once, without touching anything the user already has. */
    seedFoods(foods) {
      const m = getMeta();
      if (m.seeded) return;
      const lib = this.getLibrary();
      this.saveLibrary({ ...lib, foods: mergeRecords(foods, lib.foods) });
      const m2 = getMeta();
      m2.seeded = true;
      setMeta(m2);
    },

    // ----- sync bookkeeping -----
    getMeta,
    setMeta,
    dirtyDays: () => getMeta().dirtyDays.slice(),
    libraryDirty: () => getMeta().libraryDirty,
    clearDirtyDay(date) {
      const m = getMeta();
      m.dirtyDays = m.dirtyDays.filter((d) => d !== date);
      setMeta(m);
    },
    clearLibraryDirty() {
      const m = getMeta();
      m.libraryDirty = false;
      setMeta(m);
    },
    getSha: (path) => getMeta().shas[path] || null,
    setSha(path, sha) {
      const m = getMeta();
      m.shas[path] = sha;
      setMeta(m);
    },
    markSynced(iso) {
      const m = getMeta();
      m.lastSync = iso;
      setMeta(m);
    },

    // ----- settings and token -----
    getSettings: () => ({ repo: DEFAULT_REPO, showCalories: false, ...read(K.settings, {}) }),
    saveSettings(patch) {
      write(K.settings, { ...this.getSettings(), ...patch });
      emit();
    },
    // The token lives only here, on this device. It is never logged or sent anywhere but GitHub.
    getToken() {
      try {
        return storage.getItem(K.token) || '';
      } catch {
        return '';
      }
    },
    setToken(token) {
      try {
        if (token) storage.setItem(K.token, token);
        else storage.removeItem(K.token);
      } catch {
        return false;
      }
      emit();
      return true;
    },
  };
}
