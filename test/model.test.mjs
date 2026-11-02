import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, copyEntries, dateStr, dayTotals, entriesFromSavedMeal, entryFromFood, hashId, isValidDate,
  mergeDay, mergeLibrary, mergeRecords, per100Of, recentFoods, rescaleEntry, savedMealFromEntries,
  scaleNutrients, searchFoods, tombstone, toNum, upsert, validateEntry, validateFood, favouriteFoods,
} from '../js/model.js';
import { entry } from '../testlib/helpers.mjs';

test('toNum accepts commas and rejects junk, negatives and NaN', () => {
  assert.equal(toNum('12,5'), 12.5);
  assert.equal(toNum(' 7 '), 7);
  assert.equal(toNum(0), 0);
  assert.equal(toNum(''), null);
  assert.equal(toNum('abc'), null);
  assert.equal(toNum(-1), null);
  assert.equal(toNum(NaN), null);
  assert.equal(toNum(Infinity), null);
});

test('dates: validity, local date string, adding days across month and leap year', () => {
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate('nope'));
  assert.equal(dateStr(new Date(2026, 10, 2, 23, 59)), '2026-11-02');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('hashId is deterministic and differs for different input', () => {
  assert.equal(hashId('c', 'a|b'), hashId('c', 'a|b'));
  assert.notEqual(hashId('c', 'a|b'), hashId('c', 'a|c'));
  assert.match(hashId('c', 'x'), /^c-[0-9a-f]{16}$/);
});

test('scaleNutrients scales per-100 g values and never returns NaN', () => {
  assert.deepEqual(scaleNutrients({ kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 }, 200), {
    kcal: 104, protein: 0.6, carbs: 28, fat: 0.4,
  });
  assert.deepEqual(scaleNutrients({}, 100), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(scaleNutrients({ kcal: 50 }, 'x'), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('entryFromFood builds a food entry with scaled nutrients', () => {
  const food = { id: 'f1', name: 'Banana', group: 'fruit', per100: { kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 } };
  const e = entryFromFood(food, 120, { date: '2026-11-02', meal: 'breakfast', now: 'T', id: 'x' });
  assert.equal(e.id, 'x');
  assert.equal(e.type, 'food');
  assert.equal(e.grams, 120);
  assert.equal(e.kcal, 106.8);
  assert.equal(e.foodId, 'f1');
  assert.equal(e.createdAt, 'T');
});

test('rescaleEntry scales nutrients in proportion; per100Of reverses it', () => {
  const e = entry({ grams: 100, kcal: 50, protein: 2, carbs: 10, fat: 1 });
  const r = rescaleEntry(e, 250);
  assert.equal(r.grams, 250);
  assert.equal(r.kcal, 125);
  assert.equal(r.protein, 5);
  assert.deepEqual(per100Of(r), { kcal: 50, protein: 2, carbs: 10, fat: 1 });
  assert.equal(rescaleEntry(e, 'abc').grams, 100);
});

test('validateFood requires name, group and calories; allows empty optional values', () => {
  assert.deepEqual(Object.keys(validateFood({ name: '', group: '', per100: {} })).sort(), ['group', 'kcal', 'name']);
  assert.deepEqual(validateFood({ name: 'Rice', group: 'starches', per100: { kcal: 130, protein: '', carbs: '', fat: '' } }), {});
  assert.ok(validateFood({ name: 'Rice', group: 'starches', per100: { kcal: 'x' } }).kcal);
  assert.ok(validateFood({ name: 'R', group: 'other', per100: { kcal: 1 }, servingG: 0 }).servingG);
  assert.ok(validateFood({ name: 'R', group: 'other', per100: { kcal: 1, protein: 'abc' } }).protein);
});

test('validateEntry catches missing amount, bad meal and bad date', () => {
  assert.deepEqual(validateEntry(entry()), {});
  assert.ok(validateEntry(entry({ grams: 0 })).grams);
  assert.ok(validateEntry(entry({ meal: 'brunch' })).meal);
  assert.ok(validateEntry(entry({ date: '2026-02-30' })).date);
  assert.ok(validateEntry(entry({ name: '  ' })).name);
});

test('dayTotals leads with fruit, vegetables and protein, skips deleted and non-food entries', () => {
  const t = dayTotals([
    entry({ id: '1', group: 'fruit', grams: 160, kcal: 80, protein: 1 }),
    entry({ id: '2', group: 'vegetables', grams: 240, kcal: 50, protein: 3 }),
    entry({ id: '3', group: 'meat', grams: 100, kcal: 165, protein: 31 }),
    entry({ id: '4', group: 'fruit', grams: 500, kcal: 999, protein: 99, deleted: true }),
    { id: '5', type: 'workout', group: 'fruit', grams: 999, kcal: 999 },
  ]);
  assert.equal(t.fruitG, 160);
  assert.equal(t.fruitPortions, 2);
  assert.equal(t.vegG, 240);
  assert.equal(t.vegPortions, 3);
  assert.equal(t.protein, 35);
  assert.equal(t.kcal, 295);
  assert.deepEqual(dayTotals([]).byGroup, {});
});

test('mergeRecords: union by id, newer wins, tombstones win when newer, order-independent', () => {
  const a = [entry({ id: 'a', updatedAt: '2026-01-01T00:00:00Z', name: 'old' }), entry({ id: 'b' })];
  const b = [entry({ id: 'a', updatedAt: '2026-01-02T00:00:00Z', name: 'new' }), entry({ id: 'c' })];
  const m1 = mergeRecords(a, b);
  const m2 = mergeRecords(b, a);
  assert.deepEqual(m1, m2);
  assert.equal(m1.length, 3);
  assert.equal(m1.find((x) => x.id === 'a').name, 'new');

  const del = tombstone(entry({ id: 'b', updatedAt: '2026-01-01T00:00:00Z' }), '2027-01-01T00:00:00Z');
  const merged = mergeRecords([entry({ id: 'b', updatedAt: '2026-01-01T00:00:00Z' })], [del]);
  assert.equal(merged[0].deleted, true);
  // An edit made after the deletion brings it back (newer wins).
  const edited = entry({ id: 'b', updatedAt: '2028-01-01T00:00:00Z' });
  assert.equal(mergeRecords([del], [edited])[0].deleted, undefined);
});

test('mergeRecords is deterministic on equal timestamps and ignores junk', () => {
  const x = entry({ id: 'a', name: 'X' });
  const y = entry({ id: 'a', name: 'Y' });
  assert.deepEqual(mergeRecords([x], [y]), mergeRecords([y], [x]));
  assert.deepEqual(mergeRecords([null, {}], undefined), []);
});

test('mergeDay and mergeLibrary keep both sides', () => {
  const d = mergeDay({ date: '2026-11-02', entries: [entry({ id: 'a' })] }, { date: '2026-11-02', entries: [entry({ id: 'b' })] });
  assert.equal(d.entries.length, 2);
  assert.equal(d.version, 1);
  const l = mergeLibrary({ foods: [{ id: 'f1', updatedAt: '1' }], meals: [] }, { foods: [{ id: 'f2', updatedAt: '1' }] });
  assert.equal(l.foods.length, 2);
  assert.deepEqual(l.meals, []);
});

test('searchFoods is accent/case-insensitive, matches every word, hides deleted', () => {
  const foods = [
    { id: '1', name: 'Pasta, cooked' },
    { id: '2', name: 'Crème fraîche' },
    { id: '3', name: 'Pasta sauce', deleted: true },
  ];
  assert.deepEqual(searchFoods(foods, 'PASTA').map((f) => f.id), ['1']);
  assert.deepEqual(searchFoods(foods, 'creme fraiche').map((f) => f.id), ['2']);
  assert.deepEqual(searchFoods(foods, 'pasta rice'), []);
  assert.equal(searchFoods(foods, '  ').length, 2);
});

test('recentFoods orders by lastUsed; favouriteFoods filters', () => {
  const foods = [
    { id: '1', name: 'B', lastUsed: '2026-01-01' },
    { id: '2', name: 'A', lastUsed: '2026-03-01', favourite: true },
    { id: '3', name: 'C', lastUsed: null },
  ];
  assert.deepEqual(recentFoods(foods).map((f) => f.id), ['2', '1']);
  assert.deepEqual(recentFoods(foods, 1).map((f) => f.id), ['2']);
  assert.deepEqual(favouriteFoods(foods).map((f) => f.id), ['2']);
});

test('copyEntries gives new ids and the new date/meal, and skips deleted and non-food', () => {
  const src = [entry({ id: 'a' }), entry({ id: 'b', deleted: true }), { id: 'w', type: 'workout' }];
  const out = copyEntries(src, { date: '2026-11-03', meal: 'dinner', now: 'N' });
  assert.equal(out.length, 1);
  assert.notEqual(out[0].id, 'a');
  assert.equal(out[0].date, '2026-11-03');
  assert.equal(out[0].meal, 'dinner');
  assert.equal(out[0].createdAt, 'N');
  assert.equal(out[0].source, 'copy');
});

test('saved meals round-trip into fresh entries', () => {
  const meal = savedMealFromEntries(' Usual breakfast ', [entry({ id: 'a', name: 'Oats' }), entry({ id: 'b', name: 'Banana' })], { id: 'm1', now: 'N' });
  assert.equal(meal.name, 'Usual breakfast');
  assert.equal(meal.items.length, 2);
  const out = entriesFromSavedMeal(meal, { date: '2026-11-04', meal: 'breakfast', now: 'N2' });
  assert.deepEqual(out.map((e) => e.name), ['Oats', 'Banana']);
  assert.ok(out.every((e) => e.date === '2026-11-04' && e.id !== 'a' && e.id !== 'b'));
  assert.notEqual(out[0].id, out[1].id);
});

test('upsert replaces by id or appends, without mutating', () => {
  const list = [{ id: 'a', v: 1 }];
  const r = upsert(list, { id: 'a', v: 2 });
  assert.equal(list[0].v, 1);
  assert.equal(r[0].v, 2);
  assert.equal(upsert(list, { id: 'b' }).length, 2);
});
