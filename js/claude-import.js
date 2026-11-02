// Parses the text block Claude produces ("Paste from Claude") and the files Claude drops in inbox/.
// Both use the same format: a JSON array of entries, or { "entries": [ ... ] }.

import { MEALS, hashId, isGroup, isValidDate, nowIso, round1, toNum } from './model.js';

const MEAL_ALIASES = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  snack: 'snacks',
  snacks: 'snacks',
};

function stripFences(text) {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (m ? m[1] : text).trim();
}

function normalizeItem(raw, index, { defaultDate, now }) {
  const where = `Item ${index + 1}`;
  if (!raw || typeof raw !== 'object') return { error: `${where} is not an entry.` };
  if (raw.type && raw.type !== 'food') return { error: `${where}: type "${raw.type}" is not supported yet.` };

  const name = String(raw.name || '').trim();
  if (!name) return { error: `${where} has no name.` };

  const grams = toNum(raw.grams);
  if (!grams || grams <= 0) return { error: `${where} (${name}) has no valid amount in grams.` };

  const date = raw.date === undefined ? defaultDate : raw.date;
  if (!isValidDate(date)) return { error: `${where} (${name}) has no valid date (use YYYY-MM-DD).` };

  const meal = MEAL_ALIASES[String(raw.meal || '').trim().toLowerCase()] || null;
  if (!meal) return { error: `${where} (${name}) needs a meal: ${MEALS.map((m) => m.id).join(', ')}.` };

  const group = isGroup(raw.group) ? raw.group : 'other';
  const kcal = toNum(raw.kcal);
  if (kcal === null) return { error: `${where} (${name}) has no calories (kcal).` };

  const id = raw.id
    ? String(raw.id)
    : hashId('claude', [date, meal, name.toLowerCase(), grams, kcal, index].join('|'));

  return {
    entry: {
      id,
      type: 'food',
      date,
      meal,
      foodId: null,
      name,
      group,
      grams: round1(grams),
      kcal: round1(kcal),
      protein: round1(toNum(raw.protein) || 0),
      carbs: round1(toNum(raw.carbs) || 0),
      fat: round1(toNum(raw.fat) || 0),
      // Anything Claude proposes is an estimate unless it says otherwise.
      estimate: raw.estimate === false ? false : true,
      source: 'claude',
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Returns { entries, errors }. `entries` are ready to merge into the diary; `errors` are
 * plain-English messages (one per rejected item, or one for the whole text); `rejected` holds the raw
 * items that were refused, so a file can be rewritten with only those.
 */
export function parseClaudeBlock(text, { defaultDate, now = nowIso() } = {}) {
  let data;
  try {
    data = JSON.parse(stripFences(String(text || '')));
  } catch {
    return { entries: [], rejected: [], errors: ['The text is not valid JSON. Paste exactly what Claude gave you.'] };
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.entries) ? data.entries : null;
  if (!list) return { entries: [], rejected: [], errors: ['No entries found. Expected a list, or { "entries": [ ... ] }.'] };
  if (!list.length) return { entries: [], rejected: [], errors: ['The list is empty.'] };

  const entries = [];
  const errors = [];
  const rejected = [];
  list.forEach((raw, i) => {
    const r = normalizeItem(raw, i, { defaultDate, now });
    if (r.error) {
      errors.push(r.error);
      rejected.push(raw);
    } else entries.push(r.entry);
  });
  return { entries, rejected, errors };
}
