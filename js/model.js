// Pure data logic for Morso: no DOM, no network, no storage. Everything here is unit-tested.

export const DATA_VERSION = 1;

// One portion of fruit or vegetables, in grams (the common "5 a day" portion size).
export const PORTION_G = 80;

export const GROUPS = [
  { id: 'fruit', label: 'Fruit' },
  { id: 'vegetables', label: 'Vegetables' },
  { id: 'legumes', label: 'Legumes' },
  { id: 'meat', label: 'Meat' },
  { id: 'fish', label: 'Fish & seafood' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'starches', label: 'Bread, pasta, rice, potatoes' },
  { id: 'nuts_seeds', label: 'Nuts & seeds' },
  { id: 'fats_oils', label: 'Fats & oils' },
  { id: 'sweets', label: 'Sweets & snacks' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'other', label: 'Other' },
];

export const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
];

export const groupLabel = (id) => (GROUPS.find((g) => g.id === id) || { label: 'Other' }).label;
export const mealLabel = (id) => (MEALS.find((m) => m.id === id) || { label: id }).label;
export const isGroup = (id) => GROUPS.some((g) => g.id === id);
export const isMeal = (id) => MEALS.some((m) => m.id === id);

// ---------- numbers ----------

/** Parse user/remote input into a finite number >= 0, or null. Never NaN. */
export function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// ---------- ids and dates ----------

export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${hex()}-${hex()}-${hex()}-${hex()}`;
}

/** Deterministic id from text, so the same pasted item never duplicates. */
export function hashId(prefix, text) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
    b ^= b >>> 13;
  }
  return `${prefix}-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s) {
  const m = DATE_RE.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Local calendar date as YYYY-MM-DD. */
export function dateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(date, n) {
  const m = DATE_RE.exec(date);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.toISOString().slice(0, 10);
}

export const nowIso = (d = new Date()) => d.toISOString();

// ---------- nutrients ----------

/** Nutrient totals for `grams` of a food whose values are per 100 g. */
export function scaleNutrients(per100, grams) {
  const f = (toNum(grams) || 0) / 100;
  const p = per100 || {};
  return {
    kcal: round1((toNum(p.kcal) || 0) * f),
    protein: round1((toNum(p.protein) || 0) * f),
    carbs: round1((toNum(p.carbs) || 0) * f),
    fat: round1((toNum(p.fat) || 0) * f),
  };
}

/** Per-100 g values of an entry (used when a food is saved from a diary line). */
export function per100Of(entry) {
  const g = toNum(entry.grams);
  if (!g) return { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const k = 100 / g;
  return {
    kcal: round1(entry.kcal * k),
    protein: round1(entry.protein * k),
    carbs: round1(entry.carbs * k),
    fat: round1(entry.fat * k),
  };
}

/** Change an entry's amount; its nutrients scale in proportion. */
export function rescaleEntry(entry, grams) {
  const old = toNum(entry.grams);
  const next = toNum(grams);
  if (!old || !next) return { ...entry, grams: next || old || 0 };
  const k = next / old;
  return {
    ...entry,
    grams: round1(next),
    kcal: round1(entry.kcal * k),
    protein: round1(entry.protein * k),
    carbs: round1(entry.carbs * k),
    fat: round1(entry.fat * k),
  };
}

// ---------- entries ----------

/** Build a diary entry (type "food") from a library food and an amount in grams. */
export function entryFromFood(food, grams, { date, meal, now = nowIso(), id = newId(), source = 'app' }) {
  const n = scaleNutrients(food.per100, grams);
  return {
    id,
    type: 'food',
    date,
    meal,
    foodId: food.id || null,
    name: food.name,
    group: food.group,
    grams: round1(toNum(grams) || 0),
    ...n,
    estimate: false,
    source,
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns { field: message } for everything wrong with a food; {} when valid. */
export function validateFood(food) {
  const e = {};
  if (!String(food.name || '').trim()) e.name = 'Give the food a name.';
  if (!isGroup(food.group)) e.group = 'Choose a food group.';
  const p = food.per100 || {};
  if (toNum(p.kcal) === null) e.kcal = 'Enter the calories per 100 g (0 if none).';
  for (const k of ['protein', 'carbs', 'fat']) {
    if (p[k] !== undefined && p[k] !== null && p[k] !== '' && toNum(p[k]) === null) {
      e[k] = 'Enter a number, or leave empty.';
    }
  }
  if (food.servingG !== undefined && food.servingG !== null && food.servingG !== '') {
    const s = toNum(food.servingG);
    if (!s || s <= 0) e.servingG = 'The serving size must be more than 0 g.';
  }
  return e;
}

export function validateEntry(entry) {
  const e = {};
  if (!String(entry.name || '').trim()) e.name = 'Give the entry a name.';
  if (!isGroup(entry.group)) e.group = 'Choose a food group.';
  if (!isMeal(entry.meal)) e.meal = 'Choose a meal.';
  if (!isValidDate(entry.date)) e.date = 'Choose a valid date.';
  const g = toNum(entry.grams);
  if (!g || g <= 0) e.grams = 'Enter an amount above 0.';
  return e;
}

// ---------- day totals ----------

export const visible = (list) => (list || []).filter((x) => x && !x.deleted);

export function dayTotals(entries) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, byGroup: {} };
  for (const e of visible(entries)) {
    if (e.type && e.type !== 'food') continue;
    t.kcal += toNum(e.kcal) || 0;
    t.protein += toNum(e.protein) || 0;
    t.carbs += toNum(e.carbs) || 0;
    t.fat += toNum(e.fat) || 0;
    t.byGroup[e.group] = (t.byGroup[e.group] || 0) + (toNum(e.grams) || 0);
  }
  const fruitG = t.byGroup.fruit || 0;
  const vegG = t.byGroup.vegetables || 0;
  return {
    kcal: Math.round(t.kcal),
    protein: round1(t.protein),
    carbs: round1(t.carbs),
    fat: round1(t.fat),
    byGroup: t.byGroup,
    fruitG: Math.round(fruitG),
    vegG: Math.round(vegG),
    fruitPortions: round1(fruitG / PORTION_G),
    vegPortions: round1(vegG / PORTION_G),
  };
}

// ---------- merging (sync) ----------

function pickNewer(a, b) {
  const ua = a.updatedAt || '';
  const ub = b.updatedAt || '';
  if (ua !== ub) return ua > ub ? a : b;
  // Same timestamp: choose deterministically so both sides converge.
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/** Union of two record lists by id; the newer updatedAt wins; deletions are tombstones. */
export function mergeRecords(a, b) {
  const byId = new Map();
  for (const rec of [...(a || []), ...(b || [])]) {
    if (!rec || !rec.id) continue;
    const cur = byId.get(rec.id);
    byId.set(rec.id, cur ? pickNewer(cur, rec) : rec);
  }
  return [...byId.values()].sort((x, y) => (x.createdAt || '').localeCompare(y.createdAt || '') || x.id.localeCompare(y.id));
}

export const emptyDay = (date) => ({ version: DATA_VERSION, date, entries: [] });
export const emptyLibrary = () => ({ version: DATA_VERSION, foods: [], meals: [] });

export function mergeDay(local, remote) {
  const date = (local && local.date) || (remote && remote.date);
  return { version: DATA_VERSION, date, entries: mergeRecords(local && local.entries, remote && remote.entries) };
}

export function mergeLibrary(local, remote) {
  return {
    version: DATA_VERSION,
    foods: mergeRecords(local && local.foods, remote && remote.foods),
    meals: mergeRecords(local && local.meals, remote && remote.meals),
  };
}

/** Stable text form used for files and for "did anything change?" comparisons. */
export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';

// ---------- quick entry ----------

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Match every word of the query against a food's name (accent- and case-insensitive). */
export function searchFoods(foods, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const list = visible(foods);
  if (!words.length) return list;
  return list.filter((f) => {
    const hay = fold(f.name);
    return words.every((w) => hay.includes(w));
  });
}

export function recentFoods(foods, limit = 12) {
  return visible(foods)
    .filter((f) => f.lastUsed)
    .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, limit);
}

export const favouriteFoods = (foods) => visible(foods).filter((f) => f.favourite).sort((a, b) => a.name.localeCompare(b.name));

/** Copies of `entries` for another date/meal, with fresh ids (the copy is a new record). */
export function copyEntries(entries, { date, meal, now = nowIso() }) {
  return visible(entries)
    .filter((e) => !e.type || e.type === 'food')
    .map((e) => ({
      ...e,
      id: newId(),
      date,
      meal: meal || e.meal,
      source: 'copy',
      createdAt: now,
      updatedAt: now,
    }));
}

/** A saved meal remembers each line's totals so it reproduces the same food. */
export function savedMealFromEntries(name, entries, { now = nowIso(), id = newId() } = {}) {
  return {
    id,
    name: String(name).trim(),
    items: visible(entries).map((e) => ({
      foodId: e.foodId || null,
      name: e.name,
      group: e.group,
      grams: e.grams,
      kcal: e.kcal,
      protein: e.protein,
      carbs: e.carbs,
      fat: e.fat,
      estimate: !!e.estimate,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function entriesFromSavedMeal(saved, { date, meal, now = nowIso() }) {
  return (saved.items || []).map((it) => ({
    id: newId(),
    type: 'food',
    date,
    meal,
    foodId: it.foodId || null,
    name: it.name,
    group: it.group,
    grams: it.grams,
    kcal: it.kcal,
    protein: it.protein,
    carbs: it.carbs,
    fat: it.fat,
    estimate: !!it.estimate,
    source: 'saved-meal',
    createdAt: now,
    updatedAt: now,
  }));
}

/** Insert or replace a record by id inside a list (immutable). */
export function upsert(list, rec) {
  const i = list.findIndex((x) => x.id === rec.id);
  if (i < 0) return [...list, rec];
  const copy = list.slice();
  copy[i] = rec;
  return copy;
}

/** Mark a record deleted without removing it, so the deletion syncs. */
export const tombstone = (rec, now = nowIso()) => ({ ...rec, deleted: true, updatedAt: now });
