// A small starter list of common generic foods so the app is useful on first open and offline.
// Values are rounded, approximate per-100 g figures (typical cooked/raw values as labelled);
// every one can be edited in the app. Not copied from any commercial database.

const STAMP = '2026-01-01T00:00:00.000Z';

// [name, group, kcal, protein, carbs, fat, servingG, servingLabel]
const ROWS = [
  ['Apple', 'fruit', 52, 0.3, 14, 0.2, 180, 'apple'],
  ['Banana', 'fruit', 89, 1.1, 23, 0.3, 120, 'banana'],
  ['Orange', 'fruit', 47, 0.9, 12, 0.1, 130, 'orange'],
  ['Pear', 'fruit', 57, 0.4, 15, 0.1, 170, 'pear'],
  ['Kiwi', 'fruit', 61, 1.1, 15, 0.5, 75, 'kiwi'],
  ['Strawberries', 'fruit', 32, 0.7, 7.7, 0.3, null, null],
  ['Blueberries', 'fruit', 57, 0.7, 14, 0.3, null, null],
  ['Grapes', 'fruit', 69, 0.7, 18, 0.2, null, null],
  ['Tomato', 'vegetables', 18, 0.9, 3.9, 0.2, 120, 'tomato'],
  ['Cucumber', 'vegetables', 15, 0.7, 3.6, 0.1, null, null],
  ['Carrot', 'vegetables', 41, 0.9, 10, 0.2, 70, 'carrot'],
  ['Broccoli', 'vegetables', 34, 2.8, 7, 0.4, null, null],
  ['Spinach', 'vegetables', 23, 2.9, 3.6, 0.4, null, null],
  ['Lettuce', 'vegetables', 15, 1.4, 2.9, 0.2, null, null],
  ['Bell pepper', 'vegetables', 31, 1, 6, 0.3, 150, 'pepper'],
  ['Courgette', 'vegetables', 17, 1.2, 3.1, 0.3, null, null],
  ['Chickpeas, cooked', 'legumes', 164, 8.9, 27, 2.6, null, null],
  ['Lentils, cooked', 'legumes', 116, 9, 20, 0.4, null, null],
  ['Kidney beans, cooked', 'legumes', 127, 8.7, 23, 0.5, null, null],
  ['Hummus', 'legumes', 166, 8, 14, 10, null, null],
  ['Chicken breast, cooked', 'meat', 165, 31, 0, 3.6, null, null],
  ['Salmon, cooked', 'fish', 206, 22, 0, 12, null, null],
  ['Tuna, canned in water', 'fish', 116, 26, 0, 0.8, null, null],
  ['Cod, cooked', 'fish', 105, 23, 0, 0.9, null, null],
  ['Egg', 'eggs', 143, 12.6, 0.7, 9.5, 55, 'egg'],
  ['Whole milk', 'dairy', 61, 3.2, 4.8, 3.3, null, null],
  ['Greek yogurt, 0% fat', 'dairy', 59, 10, 3.6, 0.4, null, null],
  ['Skyr', 'dairy', 63, 11, 4, 0.2, null, null],
  ['Cheddar', 'dairy', 403, 25, 1.3, 33, null, null],
  ['Mozzarella', 'dairy', 280, 28, 3, 17, null, null],
  ['Parmesan', 'dairy', 431, 38, 4.1, 29, null, null],
  ['Oats', 'starches', 389, 16.9, 66, 6.9, null, null],
  ['White rice, cooked', 'starches', 130, 2.7, 28, 0.3, null, null],
  ['Pasta, cooked', 'starches', 158, 5.8, 31, 0.9, null, null],
  ['Potato, boiled', 'starches', 87, 1.9, 20, 0.1, null, null],
  ['Wholemeal bread', 'starches', 247, 13, 41, 3.4, 35, 'slice'],
  ['White bread', 'starches', 265, 9, 49, 3.2, 35, 'slice'],
  ['Almonds', 'nuts_seeds', 579, 21, 22, 50, null, null],
  ['Walnuts', 'nuts_seeds', 654, 15, 14, 65, null, null],
  ['Peanut butter', 'nuts_seeds', 588, 25, 20, 50, null, null],
  ['Olive oil', 'fats_oils', 884, 0, 0, 100, null, null],
  ['Butter', 'fats_oils', 717, 0.9, 0.1, 81, null, null],
  ['Dark chocolate, 70%', 'sweets', 598, 7.8, 46, 43, null, null],
  ['Orange juice', 'drinks', 45, 0.7, 10, 0.2, null, null],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const STARTER_FOODS = ROWS.map(([name, group, kcal, protein, carbs, fat, servingG, servingLabel]) => ({
  id: `starter-${slug(name)}`,
  name,
  group,
  per100: { kcal, protein, carbs, fat },
  servingG,
  servingLabel,
  barcode: null,
  source: 'starter',
  favourite: false,
  lastUsed: null,
  createdAt: STAMP,
  updatedAt: STAMP,
}));
