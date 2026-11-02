// Morso: app shell, navigation and screens (step 1: food diary).

import {
  GROUPS, MEALS, addDays, copyEntries, dateStr, dayTotals, entriesFromSavedMeal, entryFromFood, favouriteFoods,
  groupLabel, mealLabel, newId, nowIso, per100Of, recentFoods, rescaleEntry, savedMealFromEntries, searchFoods,
  tombstone, toNum, validateEntry, validateFood, visible, round1,
} from './model.js';
import { createStore, memoryStorage } from './store.js';
import { createGitHub } from './github.js';
import { createSync } from './sync.js';
import { parseClaudeBlock } from './claude-import.js';
import { searchOff } from './off.js';
import { STARTER_FOODS } from './starter-foods.js';
import { confirmDialog, fill, h, promptDialog, toast } from './ui.js';

// ---------- setup ----------

function pickStorage() {
  try {
    const s = window.localStorage;
    s.setItem('morso:probe', '1');
    s.removeItem('morso:probe');
    return s;
  } catch {
    return null;
  }
}
const storage = pickStorage();
const store = createStore(storage || memoryStorage());
store.seedFoods(STARTER_FOODS);

const root = document.getElementById('screen');
const app = {
  date: dateStr(),
  followToday: true,
  stack: [{ name: 'home', params: {} }],
  guard: null, // returns true when the open screen has unsaved edits
  sync: { state: 'idle', message: '' },
  pillEl: null,
};

const GROUP_OPTIONS = GROUPS.map((g) => [g.id, g.label]);
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('en-GB');

function dateLabel(date) {
  const today = dateStr();
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------- navigation ----------

const SCREENS = {};

function render({ keepScroll = false } = {}) {
  app.guard = null;
  app.pillEl = null;
  const top = app.stack[app.stack.length - 1];
  const el = SCREENS[top.name](top.params || {});
  root.replaceChildren(el);
  if (keepScroll) return;
  window.scrollTo(0, 0);
  const heading = el.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

const go = (name, params = {}) => {
  app.stack.push({ name, params });
  render();
};
const replaceTop = (name, params = {}) => {
  app.stack[app.stack.length - 1] = { name, params };
  render();
};

async function canLeave() {
  if (!app.guard || !app.guard()) return true;
  return confirmDialog({
    title: 'Discard your changes?',
    message: 'You have edits that are not saved yet.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    danger: true,
  });
}

async function back() {
  if (app.stack.length <= 1 || !(await canLeave())) return;
  app.stack.pop();
  render();
}

async function goHome() {
  if (!(await canLeave())) return;
  app.stack = [{ name: 'home', params: {} }];
  render();
}

/** After a successful save: back to the list (home), without asking again. */
function finishToHome() {
  app.guard = null;
  app.stack = [{ name: 'home', params: {} }];
  render();
}

// ---------- shared pieces ----------

function header(title, { back: showBack = true, home = false, actions = [] } = {}) {
  return h('header', { class: 'bar' },
    showBack ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onClick: back }, '‹') : null,
    h('h1', {}, title),
    h('div', { class: 'bar-actions' },
      ...actions,
      home ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Home', onClick: goHome }, '⌂') : null,
    ),
  );
}

function field({ id, label, control, error, hint }) {
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');
  if (describedBy) control.setAttribute('aria-describedby', describedBy);
  if (error) control.setAttribute('aria-invalid', 'true');
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    control,
    hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
    h('p', { class: 'error', id: `${id}-err`, role: 'alert' }, error || ''),
  );
}

function selectEl(id, options, value, placeholder) {
  return h('select', { id },
    placeholder ? h('option', { value: '' }, placeholder) : null,
    options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)),
  );
}

const numInput = (id, value, placeholder = '') =>
  h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, value: value === null || value === undefined ? '' : String(value) });

function setError(id, message) {
  const err = document.getElementById(`${id}-err`);
  const ctl = document.getElementById(id);
  if (err) err.textContent = message || '';
  if (ctl) {
    if (message) ctl.setAttribute('aria-invalid', 'true');
    else ctl.removeAttribute('aria-invalid');
  }
}

/** Show errors, jump to and focus the first empty/invalid field (P20). Returns true when valid. */
function showErrors(errors, order) {
  for (const id of order) setError(id, errors[id]);
  const first = order.find((id) => errors[id]);
  if (first) {
    const ctl = document.getElementById(first);
    ctl.scrollIntoView({ block: 'center' });
    ctl.focus();
    return false;
  }
  return true;
}

// ---------- sync ----------

let syncTimer;
let syncStarted = false;

function pendingCount() {
  return store.dirtyDays().length + (store.libraryDirty() ? 1 : 0);
}

function pillInfo() {
  const hasToken = !!store.getToken();
  const pending = pendingCount();
  const s = app.sync;
  if (!hasToken) return { text: 'Sync off', cls: 'off' };
  if (s.state === 'syncing') return { text: 'Syncing…', cls: 'busy' };
  if (s.state === 'auth') return { text: 'Token problem', cls: 'bad' };
  if (s.state === 'offline') return { text: pending ? `Offline · ${pending} waiting` : 'Offline', cls: 'warn' };
  if (s.state === 'error') return { text: 'Sync problem', cls: 'bad' };
  if (pending) return { text: `${pending} waiting`, cls: 'warn' };
  return { text: 'Synced', cls: 'ok' };
}

function syncInfoText() {
  const last = store.getMeta().lastSync;
  const pending = pendingCount();
  return [
    'Your diary is saved on this phone first. With a token it also syncs to your private data repository.',
    pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync.` : '',
    last ? `Last sync: ${new Date(last).toLocaleString('en-GB')}.` : 'Not synced yet.',
  ].filter(Boolean).join(' ');
}

function refreshPill() {
  const info = document.getElementById('sync-info');
  if (info) info.textContent = syncInfoText();
  if (!app.pillEl) return;
  const { text, cls } = pillInfo();
  app.pillEl.textContent = text;
  app.pillEl.className = `pill ${cls}`;
}

function makeSync() {
  const { repo } = store.getSettings();
  return createSync({ store, github: createGitHub({ token: store.getToken(), repo }) });
}

async function runSync({ manual = false } = {}) {
  if (!store.getToken()) {
    if (manual) toast('Sync is off. Add your GitHub token in Settings.');
    return;
  }
  if (!navigator.onLine) {
    app.sync = { state: 'offline', message: '' };
    refreshPill();
    if (manual) toast('You are offline. Your changes are saved on this phone and will sync later.');
    return;
  }
  app.sync = { state: 'syncing', message: '' };
  refreshPill();
  const r = await makeSync().run();
  if (!r) return; // another run was already in progress; it will pick up the changes
  app.sync = { state: r.state, message: r.message };
  refreshPill();
  if (r.imported) toast(`Imported ${r.imported} ${r.imported === 1 ? 'entry' : 'entries'} from Claude.`);
  else if (r.importErrors.length) toast(`Could not import: ${r.importErrors[0]}`, { ms: 8000 });
  else if (r.state !== 'ok' && manual) toast(r.message, { ms: 8000 });
  else if (manual) toast('Everything is synced.');
  if (r.imported || r.pulled) refreshHome();
}

function scheduleSync(delay = 2000) {
  if (!store.getToken()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(), delay);
}

function refreshHome() {
  if (app.stack[app.stack.length - 1].name === 'home' && !document.querySelector('dialog[open]')) render({ keepScroll: true });
}

function startSyncing() {
  if (syncStarted) return;
  syncStarted = true;
  store.subscribe(() => {
    refreshPill();
    if (pendingCount()) scheduleSync();
  });
  window.addEventListener('online', () => scheduleSync(500));
  window.addEventListener('offline', () => {
    app.sync = { state: 'offline', message: '' };
    refreshPill();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (app.followToday && app.date !== dateStr()) {
      app.date = dateStr();
      refreshHome();
    }
    scheduleSync(300);
  });
  scheduleSync(300);
}

// ---------- HOME ----------

SCREENS.home = () => {
  const date = app.date;
  const settings = store.getSettings();
  const day = store.getDay(date);
  const entries = visible(day.entries).filter((e) => !e.type || e.type === 'food');
  const t = dayTotals(entries);

  const pill = h('button', { type: 'button', class: 'pill', onClick: () => (store.getToken() ? runSync({ manual: true }) : go('settings')) });
  app.pillEl = pill;
  queueMicrotask(refreshPill);

  const setDate = (d) => {
    app.date = d;
    app.followToday = d === dateStr();
    render();
  };

  const tile = (label, big, unit, small, id) =>
    h('div', { class: 'tile', id },
      h('span', { class: 'tile-label' }, label),
      h('span', { class: 'tile-big' }, big, h('span', { class: 'tile-unit' }, ` ${unit}`)),
      h('span', { class: 'tile-small' }, small),
    );

  const summary = h('section', { class: 'summary', 'aria-label': 'Daily summary' },
    h('div', { class: 'tiles' },
      tile('Fruit', fmt(t.fruitPortions), 'portions', `${t.fruitG} g`, 'tile-fruit'),
      tile('Vegetables', fmt(t.vegPortions), 'portions', `${t.vegG} g`, 'tile-veg'),
      tile('Protein', fmt(t.protein), 'g', 'total', 'tile-protein'),
    ),
    settings.showCalories
      ? h('p', { class: 'cal-line', id: 'cal-line' }, `${t.kcal.toLocaleString('en-GB')} kcal · carbs ${fmt(t.carbs)} g · fat ${fmt(t.fat)} g`)
      : null,
    h('button', {
      type: 'button',
      class: 'link',
      'aria-pressed': settings.showCalories ? 'true' : 'false',
      onClick: () => {
        store.saveSettings({ showCalories: !settings.showCalories });
        render();
      },
    }, settings.showCalories ? 'Hide calories' : 'Show calories'),
  );

  const mealSection = (meal) => {
    const list = entries.filter((e) => e.meal === meal.id);
    const kcal = Math.round(list.reduce((s, e) => s + (toNum(e.kcal) || 0), 0));
    return h('section', { class: 'meal', 'aria-labelledby': `meal-${meal.id}` },
      h('div', { class: 'meal-head' },
        h('h2', { id: `meal-${meal.id}` }, meal.label),
        settings.showCalories && list.length ? h('span', { class: 'meal-kcal' }, `${kcal} kcal`) : null,
      ),
      list.length
        ? h('ul', { class: 'list' },
            list.map((e) =>
              h('li', {},
                h('button', { type: 'button', class: 'row', onClick: () => go('entry', { id: e.id, date }) },
                  h('span', { class: 'row-main' },
                    h('span', { class: 'row-name' }, e.name),
                    e.estimate ? h('span', { class: 'badge', title: 'Estimated amount' }, 'est.') : null,
                  ),
                  h('span', { class: 'row-meta' },
                    `${fmt(e.grams)} g · ${groupLabel(e.group)}`,
                    settings.showCalories ? ` · ${Math.round(e.kcal)} kcal` : '',
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'empty' }, 'Nothing yet.'),
      h('div', { class: 'meal-actions' },
        h('button', { type: 'button', class: 'btn primary small', onClick: () => go('add', { date, meal: meal.id }) }, `+ Add to ${meal.label.toLowerCase()}`),
        list.length
          ? h('button', { type: 'button', class: 'btn small', onClick: () => saveAsMeal(meal, list) }, 'Save as meal')
          : null,
      ),
    );
  };

  return h('div', { class: 'screen' },
    h('header', { class: 'bar' },
      h('h1', {}, 'Morso'),
      h('div', { class: 'bar-actions' },
        pill,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', onClick: () => go('settings') }, '⚙'),
      ),
    ),
    h('nav', { class: 'datenav', 'aria-label': 'Choose day' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous day', onClick: () => setDate(addDays(date, -1)) }, '‹'),
      h('label', { class: 'datepick' },
        h('span', { class: 'datepick-label', id: 'date-label' }, dateLabel(date)),
        h('input', {
          type: 'date', value: date, 'aria-label': 'Pick a date',
          onChange: (ev) => ev.target.value && setDate(ev.target.value),
        }),
      ),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next day', onClick: () => setDate(addDays(date, 1)) }, '›'),
    ),
    summary,
    MEALS.map(mealSection),
    h('nav', { class: 'footer-links', 'aria-label': 'More' },
      h('button', { type: 'button', class: 'btn', onClick: () => go('foods') }, 'My foods & meals'),
      h('button', { type: 'button', class: 'btn', onClick: () => go('paste', { date }) }, 'Paste from Claude'),
    ),
  );
};

async function saveAsMeal(meal, list) {
  const name = await promptDialog({
    title: 'Save as meal',
    label: `Name for these ${list.length} item${list.length === 1 ? '' : 's'}`,
    placeholder: `e.g. Usual ${meal.label.toLowerCase()}`,
    confirmLabel: 'Save meal',
  });
  if (!name) return;
  if (!store.putMeal(savedMealFromEntries(name, list))) return toast('This phone has no room left to save. Nothing was changed.');
  toast(`Saved “${name}”. Find it under Add.`);
}

// ---------- ADD ----------

SCREENS.add = ({ date, meal }) => {
  const results = h('div', { id: 'add-results' });
  const online = h('div', { id: 'add-online', 'aria-live': 'polite' });
  let query = '';
  let controller;

  const foodButton = (f, extra) =>
    h('li', {},
      h('button', { type: 'button', class: 'row', onClick: () => go('amount', { food: f, date, meal }) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-name' }, f.name), f.favourite ? h('span', { class: 'star', 'aria-label': 'favourite' }, '★') : null),
        h('span', { class: 'row-meta' }, `${groupLabel(f.group)} · ${f.per100 && f.per100.kcal !== null ? Math.round(f.per100.kcal) : '?'} kcal/100 g${extra || ''}`),
      ),
    );

  const section = (title, items) =>
    items.length ? h('section', { class: 'block' }, h('h2', {}, title), h('ul', { class: 'list' }, items)) : null;

  function drawLocal() {
    const lib = store.getLibrary();
    if (query.trim()) {
      const found = searchFoods(lib.foods, query).slice(0, 40);
      const meals = visible(lib.meals).filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));
      fill(results, 
        section('Saved meals', meals.map((m) => mealButton(m))),
        section('My foods', found.map((f) => foodButton(f))),
        !found.length && !meals.length ? h('p', { class: 'empty' }, 'No match in your foods. Try Open Food Facts below, or create the food yourself.') : null,
      );
      return;
    }
    const yesterday = store.getDay(addDays(date, -1));
    const yList = visible(yesterday.entries).filter((e) => e.meal === meal && (!e.type || e.type === 'food'));
    fill(results, 
      yList.length
        ? h('button', { type: 'button', class: 'btn wide', onClick: () => copyFromYesterday(yList) }, `Copy yesterday's ${mealLabel(meal).toLowerCase()} (${yList.length})`)
        : null,
      section('Saved meals', visible(lib.meals).sort((a, b) => a.name.localeCompare(b.name)).map((m) => mealButton(m))),
      section('Favourites', favouriteFoods(lib.foods).map((f) => foodButton(f))),
      section('Recent', recentFoods(lib.foods).map((f) => foodButton(f))),
      h('p', { class: 'hint' }, 'Type to search your foods, or search Open Food Facts for packaged products.'),
    );
  }

  function mealButton(m) {
    return h('li', {},
      h('button', { type: 'button', class: 'row', onClick: () => addSavedMeal(m) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-name' }, m.name), h('span', { class: 'badge' }, 'meal')),
        h('span', { class: 'row-meta' }, `${m.items.length} item${m.items.length === 1 ? '' : 's'} · ${Math.round(m.items.reduce((s, i) => s + (i.kcal || 0), 0))} kcal`),
      ),
    );
  }

  async function addSavedMeal(m) {
    const items = entriesFromSavedMeal(m, { date, meal });
    if (!(await confirmDialog({ title: `Add “${m.name}”?`, message: `${items.length} item${items.length === 1 ? '' : 's'} will be added to ${mealLabel(meal).toLowerCase()} on ${dateLabel(date).toLowerCase()}.`, confirmLabel: 'Add' }))) return;
    if (!store.putEntries(date, items)) return toast('This phone has no room left to save. Nothing was added.');
    toast(`Added “${m.name}”.`);
    app.date = date;
    finishToHome();
  }

  function copyFromYesterday(list) {
    const copies = copyEntries(list, { date, meal });
    if (!store.putEntries(date, copies)) return toast('This phone has no room left to save. Nothing was added.');
    toast(`Copied ${copies.length} item${copies.length === 1 ? '' : 's'} from yesterday.`);
    app.date = date;
    finishToHome();
  }

  async function searchOnline() {
    const q = query.trim();
    if (!q) return toast('Type what you are looking for first.');
    if (!navigator.onLine) return fill(online, h('p', { class: 'notice' }, 'You are offline. Search works on your own foods; add the food yourself or try again with a connection.'));
    controller?.abort();
    controller = new AbortController();
    fill(online, h('p', { class: 'notice' }, 'Searching Open Food Facts…'));
    try {
      const foods = await searchOff(q, { signal: controller.signal });
      fill(online, 
        foods.length
          ? section('Open Food Facts', foods.map((f) => foodButton(f, f.incomplete ? ' · incomplete' : '')))
          : h('p', { class: 'notice' }, 'Nothing found on Open Food Facts. You can add the food yourself.'),
        h('p', { class: 'hint' }, 'Open Food Facts values come from volunteers and can be wrong. You will check them before saving.'),
      );
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      fill(online, h('p', { class: 'notice', role: 'alert' }, err && err.message ? err.message : 'The search did not work. You can add the food yourself.'));
    }
  }

  const search = h('input', {
    id: 'q', type: 'search', placeholder: 'Search foods', autocomplete: 'off', autocapitalize: 'none', enterkeyhint: 'search',
    onInput: (ev) => {
      query = ev.target.value;
      fill(online, );
      drawLocal();
    },
    onKeydown: (ev) => ev.key === 'Enter' && (ev.preventDefault(), searchOnline()),
  });
  drawLocal();

  return h('div', { class: 'screen' },
    header(`Add to ${mealLabel(meal).toLowerCase()}`, { home: true }),
    h('p', { class: 'sub' }, dateLabel(date)),
    h('div', { class: 'field' },
      h('label', { for: 'q', class: 'visually-hidden' }, 'Search foods'),
      search,
    ),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', onClick: searchOnline }, 'Search Open Food Facts'),
      h('button', { type: 'button', class: 'btn', onClick: () => go('food', { food: null, name: query.trim(), onSaved: (saved) => { app.stack.pop(); go('amount', { food: saved, date, meal }); } }) }, '+ New food'),
    ),
    online,
    results,
  );
};

// ---------- AMOUNT ----------

SCREENS.amount = ({ food, date, meal }) => {
  const saved = visible(store.getLibrary().foods).find((f) => f.id === food.id);
  const isDraft = !saved;
  const unitG = toNum(food.servingG) > 0 ? toNum(food.servingG) : null;
  let currentMeal = meal;

  const gramsInput = numInput('grams', unitG || 100, 'grams');
  const preview = h('p', { class: 'preview', id: 'preview', 'aria-live': 'polite' });

  const drawPreview = () => {
    const g = toNum(gramsInput.value) || 0;
    const kcal = Math.round(((toNum(food.per100.kcal) || 0) * g) / 100);
    const p = round1(((toNum(food.per100.protein) || 0) * g) / 100);
    preview.textContent = g > 0 ? `${fmt(g)} g → ${kcal} kcal · protein ${fmt(p)} g` : 'Enter an amount to see the totals.';
  };
  gramsInput.addEventListener('input', drawPreview);
  drawPreview();

  const quick = [h('button', { type: 'button', class: 'chip', onClick: () => { gramsInput.value = '100'; drawPreview(); } }, '100 g')];
  if (unitG) {
    for (const n of [1, 2]) {
      quick.unshift(h('button', { type: 'button', class: 'chip', onClick: () => { gramsInput.value = String(round1(unitG * n)); drawPreview(); } },
        `${n} ${food.servingLabel || 'serving'}${n > 1 ? 's' : ''} (${round1(unitG * n)} g)`));
    }
    quick.reverse();
  }

  const mealSelect = selectEl('meal', MEALS.map((m) => [m.id, m.label]), currentMeal);
  mealSelect.addEventListener('change', () => { currentMeal = mealSelect.value; addBtn.textContent = `Add to ${mealLabel(currentMeal).toLowerCase()}`; });

  const needsValues = food.incomplete || validateFood(food).kcal;
  const addBtn = h('button', { type: 'button', class: 'btn primary wide', disabled: !!needsValues, onClick: add }, `Add to ${mealLabel(currentMeal).toLowerCase()}`);

  function add() {
    const grams = toNum(gramsInput.value);
    if (!grams || grams <= 0) {
      showErrors({ grams: 'Enter an amount above 0.' }, ['grams']);
      return;
    }
    const now = nowIso();
    // Foods found online join the library only now that the user is actually logging them.
    const toSave = { ...food, incomplete: undefined, lastUsed: now, updatedAt: now };
    delete toSave.incomplete;
    const okFood = store.putFood(toSave);
    const entry = entryFromFood(toSave, grams, { date, meal: currentMeal, now });
    if (!okFood || !store.putEntries(date, [entry])) return toast('This phone has no room left to save. Nothing was added.');
    toast(`Added ${food.name} to ${mealLabel(currentMeal).toLowerCase()}.`);
    app.date = date;
    finishToHome();
  }

  const toggleFav = () => {
    const now = nowIso();
    const updated = { ...(saved || food), favourite: !(saved || food).favourite, updatedAt: now };
    delete updated.incomplete;
    if (needsValues) return toast('Check and save the values first (Edit food).');
    store.putFood(updated);
    replaceTop('amount', { food: updated, date, meal: currentMeal });
  };

  return h('div', { class: 'screen' },
    header('How much?'),
    h('section', { class: 'card' },
      h('h2', { class: 'food-title' }, food.name),
      h('p', { class: 'sub' }, `${groupLabel(food.group)} · per 100 g: ${food.per100.kcal === null ? '?' : Math.round(food.per100.kcal)} kcal, protein ${food.per100.protein ?? '?'} g, carbs ${food.per100.carbs ?? '?'} g, fat ${food.per100.fat ?? '?'} g`),
      food.source === 'off' && isDraft ? h('p', { class: 'notice' }, 'From Open Food Facts: these values can be wrong or missing. Check them with Edit food.') : null,
      needsValues ? h('p', { class: 'notice', role: 'alert' }, 'Some values are missing. Use Edit food to fill them in before adding.') : null,
    ),
    field({ id: 'grams', label: 'Amount (grams)', control: gramsInput }),
    h('div', { class: 'chips' }, quick),
    preview,
    field({ id: 'meal', label: 'Meal', control: mealSelect }),
    addBtn,
    h('div', { class: 'row-actions' },
      h('button', {
        type: 'button', class: 'btn', onClick: () => go('food', {
          food,
          onSaved: (s) => { app.stack.pop(); replaceTop('amount', { food: s, date, meal: currentMeal }); },
        }),
      }, 'Edit food'),
      h('button', { type: 'button', class: 'btn', 'aria-pressed': (saved || food).favourite ? 'true' : 'false', onClick: toggleFav }, (saved || food).favourite ? '★ Favourite' : '☆ Make favourite'),
    ),
  );
};

// ---------- FOOD FORM (create / edit) ----------

SCREENS.food = ({ food, name = '', onSaved }) => {
  const isNew = !food;
  const base = food || {
    id: newId(), name, group: '', per100: { kcal: null, protein: null, carbs: null, fat: null },
    servingG: null, servingLabel: null, barcode: null, source: 'own', favourite: false, lastUsed: null,
  };
  const existsInLibrary = !!visible(store.getLibrary().foods).find((f) => f.id === base.id);

  const ctl = {
    name: h('input', { id: 'name', type: 'text', autocomplete: 'off', placeholder: 'e.g. Wholemeal bread', value: base.name }),
    group: selectEl('group', GROUP_OPTIONS, base.group, 'Choose a food group…'),
    kcal: numInput('kcal', base.per100.kcal, 'e.g. 250'),
    protein: numInput('protein', base.per100.protein, 'g, optional'),
    carbs: numInput('carbs', base.per100.carbs, 'g, optional'),
    fat: numInput('fat', base.per100.fat, 'g, optional'),
    servingLabel: h('input', { id: 'servingLabel', type: 'text', autocomplete: 'off', placeholder: 'e.g. slice', value: base.servingLabel || '' }),
    servingG: numInput('servingG', base.servingG, 'grams per serving, optional'),
  };
  const fav = h('input', { id: 'favourite', type: 'checkbox', checked: !!base.favourite });

  const read = () => ({
    ...base,
    name: ctl.name.value.trim(),
    group: ctl.group.value,
    per100: { kcal: ctl.kcal.value.trim(), protein: ctl.protein.value.trim(), carbs: ctl.carbs.value.trim(), fat: ctl.fat.value.trim() },
    servingG: ctl.servingG.value.trim(),
    servingLabel: ctl.servingLabel.value.trim(),
    favourite: fav.checked,
  });
  const snapshot = () => JSON.stringify(read());
  const initial = snapshot();
  app.guard = () => snapshot() !== initial;

  async function save() {
    const draft = read();
    const errors = validateFood(draft);
    if (!showErrors(errors, ['name', 'group', 'kcal', 'protein', 'carbs', 'fat', 'servingG'])) return;
    if (!isNew && existsInLibrary && !(await confirmDialog({ title: 'Save changes to this food?', message: 'Past diary entries keep the values they were logged with.', confirmLabel: 'Save' }))) return;
    const now = nowIso();
    const per = draft.per100;
    const clean = {
      ...base,
      name: draft.name,
      group: draft.group,
      per100: { kcal: toNum(per.kcal), protein: toNum(per.protein) ?? 0, carbs: toNum(per.carbs) ?? 0, fat: toNum(per.fat) ?? 0 },
      servingG: toNum(draft.servingG) || null,
      servingLabel: toNum(draft.servingG) ? draft.servingLabel || 'serving' : null,
      favourite: draft.favourite,
      updatedAt: now,
      createdAt: base.createdAt || now,
    };
    delete clean.incomplete;
    if (!store.putFood(clean)) return toast('This phone has no room left to save. Nothing was changed.');
    app.guard = null;
    toast('Food saved.');
    onSaved(clean);
  }

  async function remove() {
    if (!(await confirmDialog({ title: `Delete “${base.name}”?`, message: 'It disappears from your food list. Past diary entries are not changed.', confirmLabel: 'Delete', danger: true }))) return;
    store.putFood(tombstone(base));
    app.guard = null;
    app.stack.pop();
    render();
    toast('Food deleted.');
  }

  return h('div', { class: 'screen' },
    header(isNew ? 'New food' : 'Edit food'),
    h('form', { novalidate: true, onSubmit: (ev) => { ev.preventDefault(); save(); } },
      field({ id: 'name', label: 'Name', control: ctl.name }),
      field({ id: 'group', label: 'Food group', control: ctl.group, hint: 'Used to count fruit, vegetables and protein sources.' }),
      h('fieldset', {},
        h('legend', {}, 'Values per 100 g'),
        field({ id: 'kcal', label: 'Calories (kcal)', control: ctl.kcal }),
        field({ id: 'protein', label: 'Protein (g)', control: ctl.protein }),
        field({ id: 'carbs', label: 'Carbs (g)', control: ctl.carbs }),
        field({ id: 'fat', label: 'Fat (g)', control: ctl.fat }),
      ),
      h('fieldset', {},
        h('legend', {}, 'One serving (optional)'),
        field({ id: 'servingLabel', label: 'Serving name', control: ctl.servingLabel }),
        field({ id: 'servingG', label: 'Serving size (g)', control: ctl.servingG }),
      ),
      h('label', { class: 'check', for: 'favourite' }, fav, ' Favourite'),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary wide' }, 'Save food'),
        !isNew && existsInLibrary ? h('button', { type: 'button', class: 'icon-btn subtle', 'aria-label': `Delete ${base.name}`, onClick: remove }, '🗑') : null,
      ),
    ),
  );
};

// ---------- ENTRY (edit / delete a diary line) ----------

SCREENS.entry = ({ id, date }) => {
  const day = store.getDay(date);
  const original = visible(day.entries).find((e) => e.id === id);
  if (!original) {
    queueMicrotask(() => { app.stack.pop(); render(); });
    return h('div', { class: 'screen' });
  }
  let lastGrams = original.grams;

  const ctl = {
    name: h('input', { id: 'name', type: 'text', autocomplete: 'off', value: original.name }),
    group: selectEl('group', GROUP_OPTIONS, original.group, 'Choose a food group…'),
    meal: selectEl('meal', MEALS.map((m) => [m.id, m.label]), original.meal),
    grams: numInput('grams', original.grams, 'grams'),
    kcal: numInput('kcal', original.kcal),
    protein: numInput('protein', original.protein),
    carbs: numInput('carbs', original.carbs),
    fat: numInput('fat', original.fat),
  };
  const est = h('input', { id: 'estimate', type: 'checkbox', checked: !!original.estimate });

  // Changing the amount rescales the nutrients; they can still be overridden afterwards.
  ctl.grams.addEventListener('change', () => {
    const g = toNum(ctl.grams.value);
    if (!g) return;
    const scaled = rescaleEntry({ ...original, grams: lastGrams, kcal: toNum(ctl.kcal.value) || 0, protein: toNum(ctl.protein.value) || 0, carbs: toNum(ctl.carbs.value) || 0, fat: toNum(ctl.fat.value) || 0 }, g);
    ctl.kcal.value = String(scaled.kcal);
    ctl.protein.value = String(scaled.protein);
    ctl.carbs.value = String(scaled.carbs);
    ctl.fat.value = String(scaled.fat);
    lastGrams = scaled.grams;
  });

  const read = () => ({
    ...original,
    name: ctl.name.value.trim(),
    group: ctl.group.value,
    meal: ctl.meal.value,
    grams: toNum(ctl.grams.value),
    kcal: toNum(ctl.kcal.value),
    protein: toNum(ctl.protein.value),
    carbs: toNum(ctl.carbs.value),
    fat: toNum(ctl.fat.value),
    estimate: est.checked,
  });
  const snapshot = () => JSON.stringify([ctl.name.value, ctl.group.value, ctl.meal.value, ctl.grams.value, ctl.kcal.value, ctl.protein.value, ctl.carbs.value, ctl.fat.value, est.checked]);
  const initial = snapshot();
  app.guard = () => snapshot() !== initial;

  async function save() {
    const draft = read();
    const errors = validateEntry(draft);
    if (draft.kcal === null) errors.kcal = 'Enter calories (0 if none).';
    if (!showErrors(errors, ['name', 'group', 'meal', 'grams', 'kcal'])) return;
    if (!(await confirmDialog({ title: 'Save changes?', confirmLabel: 'Save' }))) return;
    const updated = { ...draft, protein: draft.protein ?? 0, carbs: draft.carbs ?? 0, fat: draft.fat ?? 0, updatedAt: nowIso() };
    if (!store.putEntries(date, [updated])) return toast('This phone has no room left to save. Nothing was changed.');
    toast('Saved.');
    finishToHome();
  }

  async function remove() {
    if (!(await confirmDialog({ title: `Delete “${original.name}”?`, message: 'It will be removed from this day.', confirmLabel: 'Delete', danger: true }))) return;
    store.putEntries(date, [tombstone(original)]);
    toast('Deleted.');
    finishToHome();
  }

  return h('div', { class: 'screen' },
    header('Edit entry'),
    h('p', { class: 'sub' }, `${dateLabel(date)}${original.source === 'claude' ? ' · added by Claude' : ''}`),
    h('form', { novalidate: true, onSubmit: (ev) => { ev.preventDefault(); save(); } },
      field({ id: 'name', label: 'Name', control: ctl.name }),
      field({ id: 'group', label: 'Food group', control: ctl.group }),
      field({ id: 'meal', label: 'Meal', control: ctl.meal }),
      field({ id: 'grams', label: 'Amount (grams)', control: ctl.grams, hint: 'Changing the amount rescales the values below.' }),
      h('fieldset', {},
        h('legend', {}, 'Totals for this amount'),
        field({ id: 'kcal', label: 'Calories (kcal)', control: ctl.kcal }),
        field({ id: 'protein', label: 'Protein (g)', control: ctl.protein }),
        field({ id: 'carbs', label: 'Carbs (g)', control: ctl.carbs }),
        field({ id: 'fat', label: 'Fat (g)', control: ctl.fat }),
      ),
      h('label', { class: 'check', for: 'estimate' }, est, ' This is an estimate'),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary wide' }, 'Save changes'),
        h('button', { type: 'button', class: 'icon-btn subtle', 'aria-label': `Delete ${original.name}`, onClick: remove }, '🗑'),
      ),
    ),
  );
};

// ---------- FOODS & MEALS manager ----------

SCREENS.foods = () => {
  const list = h('div', { id: 'foods-list' });
  let query = '';

  function draw() {
    const lib = store.getLibrary();
    const foods = searchFoods(lib.foods, query).sort((a, b) => a.name.localeCompare(b.name));
    const meals = visible(lib.meals).sort((a, b) => a.name.localeCompare(b.name));
    fill(list, 
      !query && meals.length
        ? h('section', { class: 'block' }, h('h2', {}, 'Saved meals'),
            h('ul', { class: 'list' }, meals.map((m) =>
              h('li', {}, h('button', { type: 'button', class: 'row', onClick: () => go('meal', { id: m.id }) },
                h('span', { class: 'row-main' }, h('span', { class: 'row-name' }, m.name)),
                h('span', { class: 'row-meta' }, `${m.items.length} item${m.items.length === 1 ? '' : 's'}`))))))
        : null,
      h('section', { class: 'block' }, h('h2', {}, `Foods (${foods.length})`),
        foods.length
          ? h('ul', { class: 'list' }, foods.slice(0, 200).map((f) =>
              h('li', {}, h('button', { type: 'button', class: 'row', onClick: () => go('food', { food: f, onSaved: () => { app.stack.pop(); render(); } }) },
                h('span', { class: 'row-main' }, h('span', { class: 'row-name' }, f.name), f.favourite ? h('span', { class: 'star', 'aria-label': 'favourite' }, '★') : null),
                h('span', { class: 'row-meta' }, `${groupLabel(f.group)} · ${Math.round(f.per100.kcal)} kcal/100 g`)))))
          : h('p', { class: 'empty' }, 'No foods match.')),
    );
  }
  draw();

  return h('div', { class: 'screen' },
    header('My foods & meals', { home: true }),
    h('div', { class: 'field' },
      h('label', { for: 'fq', class: 'visually-hidden' }, 'Search foods'),
      h('input', { id: 'fq', type: 'search', placeholder: 'Search foods', autocomplete: 'off', onInput: (ev) => { query = ev.target.value; draw(); } }),
    ),
    h('button', { type: 'button', class: 'btn wide', onClick: () => go('food', { food: null, onSaved: () => { app.stack.pop(); render(); } }) }, '+ New food'),
    list,
  );
};

SCREENS.meal = ({ id }) => {
  const meal = visible(store.getLibrary().meals).find((m) => m.id === id);
  if (!meal) {
    queueMicrotask(() => { app.stack.pop(); render(); });
    return h('div', { class: 'screen' });
  }
  const nameInput = h('input', { id: 'mname', type: 'text', value: meal.name, autocomplete: 'off', maxlength: '60' });
  app.guard = () => nameInput.value !== meal.name;

  async function save() {
    const name = nameInput.value.trim();
    if (!showErrors({ mname: name ? '' : 'Please type a name.' }, ['mname'])) return;
    if (!(await confirmDialog({ title: 'Rename this meal?', confirmLabel: 'Save' }))) return;
    store.putMeal({ ...meal, name, updatedAt: nowIso() });
    app.guard = null;
    toast('Meal saved.');
    app.stack.pop();
    render();
  }
  async function remove() {
    if (!(await confirmDialog({ title: `Delete “${meal.name}”?`, message: 'Past diary entries are not changed.', confirmLabel: 'Delete', danger: true }))) return;
    store.putMeal(tombstone(meal));
    app.guard = null;
    app.stack.pop();
    render();
    toast('Meal deleted.');
  }

  return h('div', { class: 'screen' },
    header('Saved meal'),
    h('form', { novalidate: true, onSubmit: (ev) => { ev.preventDefault(); save(); } },
      field({ id: 'mname', label: 'Name', control: nameInput }),
      h('h2', {}, 'Items'),
      h('ul', { class: 'list' }, meal.items.map((i) => h('li', { class: 'plain' }, `${i.name} · ${fmt(i.grams)} g · ${Math.round(i.kcal)} kcal`))),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary wide' }, 'Save name'),
        h('button', { type: 'button', class: 'icon-btn subtle', 'aria-label': `Delete ${meal.name}`, onClick: remove }, '🗑'),
      ),
    ),
  );
};

// ---------- PASTE FROM CLAUDE ----------

const CLAUDE_PROMPT = `Please turn what I ate into entries for my food diary app. Reply with ONLY one JSON code block, a list like this (one object per food, amounts in grams, calories and macros for the whole portion):
[{"date":"YYYY-MM-DD","meal":"breakfast|lunch|dinner|snacks","name":"...","group":"fruit|vegetables|legumes|meat|fish|eggs|dairy|starches|nuts_seeds|fats_oils|sweets|drinks|other","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0,"estimate":true}]`;

SCREENS.paste = ({ date }) => {
  const area = h('textarea', { id: 'paste', rows: '8', placeholder: 'Paste the block Claude gave you here', autocapitalize: 'none', spellcheck: 'false' });
  const result = h('div', { id: 'paste-result', 'aria-live': 'polite' });
  const importBtn = h('button', { type: 'button', class: 'btn primary wide', disabled: true }, 'Import');
  let parsed = null;
  app.guard = () => area.value.trim().length > 0;

  function check() {
    parsed = parseClaudeBlock(area.value, { defaultDate: date });
    importBtn.disabled = !parsed.entries.length;
    if (!area.value.trim()) return fill(result, );
    fill(result, 
      parsed.entries.length
        ? h('div', { class: 'notice ok' },
            h('p', {}, `${parsed.entries.length} ${parsed.entries.length === 1 ? 'entry' : 'entries'} ready to import (marked as estimates):`),
            h('ul', {}, parsed.entries.map((e) => h('li', {}, `${e.date} · ${mealLabel(e.meal)} · ${e.name} · ${fmt(e.grams)} g · ${Math.round(e.kcal)} kcal`))))
        : null,
      parsed.errors.length ? h('div', { class: 'notice', role: 'alert' }, h('ul', {}, parsed.errors.map((m) => h('li', {}, m)))) : null,
    );
  }
  area.addEventListener('input', check);

  importBtn.addEventListener('click', async () => {
    if (!parsed || !parsed.entries.length) return;
    const fresh = parsed.entries.filter((e) => !store.getDay(e.date).entries.some((x) => x.id === e.id));
    if (!fresh.length) return toast('These entries are already in your diary. Nothing was imported twice.');
    if (!(await confirmDialog({ title: `Import ${fresh.length} ${fresh.length === 1 ? 'entry' : 'entries'}?`, confirmLabel: 'Import' }))) return;
    for (const e of fresh) if (!store.putEntries(e.date, [e])) return toast('This phone has no room left to save. Import stopped.');
    app.date = fresh[0].date;
    app.followToday = app.date === dateStr();
    toast(`Imported ${fresh.length} ${fresh.length === 1 ? 'entry' : 'entries'}.`);
    finishToHome();
  });

  return h('div', { class: 'screen' },
    header('Paste from Claude'),
    h('p', { class: 'sub' }, 'Ask Claude to describe your meal as entries, then paste its answer here.'),
    h('button', {
      type: 'button', class: 'btn wide',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(CLAUDE_PROMPT);
          toast('Copied. Paste it to Claude, together with what you ate.');
        } catch {
          area.value = CLAUDE_PROMPT;
          area.select();
          toast('Select and copy this text, then paste it to Claude.');
        }
      },
    }, 'Copy instructions for Claude'),
    field({ id: 'paste', label: 'Claude’s answer', control: area }),
    result,
    importBtn,
  );
};

// ---------- SETTINGS ----------

SCREENS.settings = () => {
  const settings = store.getSettings();
  const tokenInput = h('input', { id: 'token', type: 'password', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: store.getToken() ? 'Token saved on this phone' : 'Paste your token' });
  const repoInput = h('input', { id: 'repo', type: 'text', autocomplete: 'off', autocapitalize: 'none', value: settings.repo });
  const status = h('p', { id: 'conn-status', class: 'notice', 'aria-live': 'polite' });
  status.hidden = true;
  const showStatus = (text, ok) => {
    status.hidden = false;
    status.textContent = text;
    status.className = `notice${ok ? ' ok' : ''}`;
  };
  app.guard = () => tokenInput.value.trim() !== '' || repoInput.value.trim() !== settings.repo;

  async function saveToken() {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();
    const errors = {};
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) errors.repo = 'Write the repository as owner/name.';
    if (!token && !store.getToken()) errors.token = 'Paste your token first.';
    if (!showErrors(errors, ['repo', 'token'])) return;
    if (!(await confirmDialog({ title: 'Save sync settings?', message: 'The token stays on this phone only.', confirmLabel: 'Save' }))) return;
    store.saveSettings({ repo });
    if (token) store.setToken(token);
    tokenInput.value = '';
    app.guard = null;
    toast('Saved. Testing the connection…');
    drawTokenActions();
    await testConnection();
  }

  async function testConnection() {
    if (!store.getToken()) return showStatus('No token saved yet.', false);
    showStatus('Testing…', false);
    try {
      const name = await createGitHub({ token: store.getToken(), repo: store.getSettings().repo }).check();
      showStatus(`Connected to ${name}. Your diary will sync in the background.`, true);
      scheduleSync(300);
    } catch (err) {
      showStatus(err && err.kind === 'notfound'
        ? 'GitHub cannot find that repository with this token. Check the name, and that the token was created for it.'
        : (err && err.message) || 'The test did not work.', false);
    }
  }

  async function removeToken() {
    if (!(await confirmDialog({ title: 'Remove the token?', message: 'Sync stops. Everything stays saved on this phone.', confirmLabel: 'Remove', danger: true }))) return;
    store.setToken('');
    app.sync = { state: 'idle', message: '' };
    toast('Token removed.');
    drawTokenActions();
    showStatus('Sync is off.', false);
    refreshPill();
  }

  const tokenActions = h('div', { id: 'token-actions' });
  const drawTokenActions = () =>
    fill(tokenActions, store.getToken() ? h('button', { type: 'button', class: 'link danger-link', onClick: removeToken }, 'Remove token from this phone') : null);
  drawTokenActions();

  return h('div', { class: 'screen' },
    header('Settings'),
    h('section', { class: 'block' },
      h('h2', {}, 'Sync with GitHub'),
      h('p', { class: 'hint', id: 'sync-info' }, syncInfoText()),
      h('form', { novalidate: true, onSubmit: (ev) => { ev.preventDefault(); saveToken(); } },
        field({ id: 'repo', label: 'Data repository', control: repoInput }),
        field({ id: 'token', label: 'GitHub token', control: tokenInput, hint: 'Fine-grained token for this repository only, with Contents: read and write.' }),
        h('button', { type: 'submit', class: 'btn primary wide' }, 'Save and test'),
      ),
      status,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn', onClick: testConnection }, 'Test connection'),
        h('button', { type: 'button', class: 'btn', onClick: () => runSync({ manual: true }) }, 'Sync now'),
      ),
      tokenActions,
    ),
    h('section', { class: 'block' },
      h('h2', {}, 'About'),
      h('p', { class: 'hint' }, 'Morso 0.1 · food diary. No photos, no tracking. Values for starter foods are approximate: edit them in My foods.'),
      storage ? null : h('p', { class: 'notice', role: 'alert' }, 'This browser is blocking storage, so nothing will be kept after you close the app.'),
    ),
  );
};

// ---------- start ----------

window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled error:', ev.reason && ev.reason.message ? ev.reason.message : 'unknown');
  toast('Something went wrong. Your data is safe on this phone.');
});

render();
startSyncing();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
