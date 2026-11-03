// Open Food Facts: search and conversion to Morso foods. Values there can be wrong or missing,
// so a result is only ever a draft that Federico checks and edits before it is saved.

import { newId, nowIso, round1, toNum } from './model.js';

const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const FIELDS = 'code,product_name,brands,nutriments,serving_quantity,categories_tags';

export class OffError extends Error {}

// First matching keyword wins. Tags look like "en:fresh-fruits".
const GROUP_RULES = [
  ['fruit', ['fruit', 'berries', 'apples', 'bananas']],
  ['vegetables', ['vegetable', 'salad', 'tomato']],
  ['legumes', ['legume', 'pulses', 'beans', 'lentils', 'chickpeas']],
  ['fish', ['fish', 'seafood', 'tuna', 'salmon']],
  ['eggs', ['eggs']],
  ['meat', ['meat', 'poultry', 'sausage', 'ham', 'beef', 'pork', 'chicken']],
  ['dairy', ['dairies', 'milk', 'cheese', 'yogurt', 'yoghurt', 'cream']],
  ['nuts_seeds', ['nuts', 'seeds']],
  ['fats_oils', ['fats', 'oils', 'butter']],
  ['sweets', ['sweet', 'snack', 'biscuit', 'chocolate', 'confectioner', 'dessert', 'cake']],
  ['drinks', ['beverage', 'drinks', 'juice', 'water']],
  ['starches', ['cereal', 'bread', 'pasta', 'rice', 'potato', 'flour']],
];

export function guessGroup(tags) {
  const text = (tags || []).join(' ').toLowerCase();
  for (const [group, words] of GROUP_RULES) {
    if (words.some((w) => text.includes(w))) return group;
  }
  return 'other';
}

/** One OFF product -> a food draft, or null if it has no usable name. */
export function offToFood(p, { now = nowIso() } = {}) {
  const base = String(p.product_name || '').trim();
  if (!base) return null;
  const brand = String(p.brands || '').split(',')[0].trim();
  const n = p.nutriments || {};
  let kcal = toNum(n['energy-kcal_100g']);
  if (kcal === null) {
    const kj = toNum(n['energy_100g']);
    if (kj !== null) kcal = Math.round(kj / 4.184);
  }
  const per100 = {
    kcal: kcal === null ? null : round1(kcal),
    protein: toNum(n.proteins_100g) === null ? null : round1(toNum(n.proteins_100g)),
    carbs: toNum(n.carbohydrates_100g) === null ? null : round1(toNum(n.carbohydrates_100g)),
    fat: toNum(n.fat_100g) === null ? null : round1(toNum(n.fat_100g)),
  };
  const serving = toNum(p.serving_quantity);
  return {
    // Stable per product, so logging the same product again reuses one library food.
    id: p.code ? `off-${p.code}` : newId(),
    name: brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${base} (${brand})` : base,
    group: guessGroup(p.categories_tags),
    per100,
    servingG: serving && serving > 0 ? serving : null,
    servingLabel: serving && serving > 0 ? 'serving' : null,
    barcode: p.code ? String(p.code) : null,
    source: 'off',
    favourite: false,
    lastUsed: null,
    // Missing numbers mean the user must fill them in before the food can be saved.
    incomplete: Object.values(per100).some((v) => v === null),
    createdAt: now,
    updatedAt: now,
  };
}

export async function searchOff(query, { fetchImpl = globalThis.fetch, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url =
    `${SEARCH_URL}?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1` +
    `&page_size=20&fields=${FIELDS}`;
  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new OffError('Could not reach Open Food Facts. Check your connection, or add the food yourself.');
  }
  if (!res.ok) {
    throw new OffError('Open Food Facts is not answering right now. Try again later, or add the food yourself.');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new OffError('Open Food Facts sent an unreadable answer. Try again, or add the food yourself.');
  }
  return (data.products || []).map((p) => offToFood(p)).filter(Boolean);
}
