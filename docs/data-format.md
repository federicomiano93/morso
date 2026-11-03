# Morso data format

All diary data lives in the private repository `morso-data` as plain JSON, so Claude Code can read
it after a `git pull`. This repository (the app) never contains any of it.

```
morso-data/
  diary/YYYY-MM-DD.json   one file per day
  library.json            own foods and saved meals
  inbox/*.json            entries proposed by Claude; the app imports them on opening, then deletes the file
```

Every record has a unique `id`. The app merges by `id` and the newest `updatedAt` wins, so retries and
repeated imports never duplicate an entry. A deletion is kept as `"deleted": true` (a tombstone) so it
syncs too; readers must skip records with `deleted: true`.

## `diary/YYYY-MM-DD.json`

```json
{
  "version": 1,
  "date": "2026-11-02",
  "entries": [
    {
      "id": "…",
      "type": "food",
      "date": "2026-11-02",
      "meal": "breakfast",
      "foodId": "starter-banana",
      "name": "Banana",
      "group": "fruit",
      "grams": 120,
      "kcal": 106.8,
      "protein": 1.3,
      "carbs": 27.6,
      "fat": 0.4,
      "estimate": false,
      "source": "app",
      "createdAt": "2026-11-02T08:01:00.000Z",
      "updatedAt": "2026-11-02T08:01:00.000Z"
    }
  ]
}
```

- `type` says what kind of entry it is. Step 1 only writes `"food"`. Workouts (step 2) will be added to
  the same day file with `"type": "workout"`; readers must ignore types they do not know.
- `meal`: `breakfast`, `lunch`, `dinner`, `snacks`.
- `group`: `fruit`, `vegetables`, `legumes`, `meat`, `fish`, `eggs`, `dairy`, `starches`, `nuts_seeds`,
  `fats_oils`, `sweets`, `drinks`, `other`.
- `grams`, `kcal`, `protein`, `carbs`, `fat` are the totals for the whole portion, not per 100 g.
- `estimate`: `true` when the amount or values are a guess (everything Claude proposes starts as one).
- `source`: `app`, `claude`, `copy` (copied from another day) or `saved-meal`.
- Times are UTC ISO strings; `date` is the local calendar day.

## `library.json`

```json
{
  "version": 1,
  "foods": [
    { "id": "…", "name": "Wholemeal bread", "group": "starches",
      "per100": { "kcal": 247, "protein": 13, "carbs": 41, "fat": 3.4 },
      "servingG": 35, "servingLabel": "slice", "barcode": null,
      "source": "own", "favourite": false, "lastUsed": null,
      "createdAt": "…", "updatedAt": "…" }
  ],
  "meals": [
    { "id": "…", "name": "Usual breakfast",
      "items": [ { "foodId": null, "name": "Oats", "group": "starches", "grams": 50,
                   "kcal": 195, "protein": 8.5, "carbs": 33, "fat": 3.5, "estimate": false } ],
      "createdAt": "…", "updatedAt": "…" }
  ]
}
```

`source` of a food: `starter` (built-in approximate values), `own` (typed in), `off` (from Open Food Facts,
checked by the user before saving).

## `inbox/*.json` and "Paste from Claude"

Claude writes entries in this shape (a list, or `{ "entries": [ … ] }`; a fenced code block is fine for pasting):

```json
[
  { "date": "2026-11-02", "meal": "dinner", "name": "Restaurant carbonara", "group": "starches",
    "grams": 400, "kcal": 850, "protein": 32, "carbs": 90, "fat": 38, "estimate": true }
]
```

Required: `meal`, `name`, `grams` (> 0), `kcal`. `date` defaults to the day being viewed (paste) or today (inbox).
`group` falls back to `other` if missing or unknown. `id` is optional: when absent the app derives a stable id
from date, meal, name, grams and kcal, so the same item imported twice stays one entry. Entries imported this
way are marked `estimate: true` unless the item says `"estimate": false`.
