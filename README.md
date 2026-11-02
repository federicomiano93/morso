# Morso

Personal iPhone app (installable PWA) for one user: food diary and, later, a gym workout log, with Claude
as the analysis partner. Plain HTML/JS, no build step, works offline. This repository holds **code only**;
the diary lives in the private repository `morso-data` (see [docs/data-format.md](docs/data-format.md)).

## Run locally

```bash
python -m http.server 5917 --bind 127.0.0.1
```

Open <http://127.0.0.1:5917/>. The service worker serves files from a cache named after their content hash: after changing any app
file run `npm run stamp` (a test fails if you forget), then reload twice (or use a private window).

## Tests

```bash
npm test
```

Uses Node's built-in test runner (Node 22+, no dependencies). CI runs it on every push. The tests cover the
data model, merging, import parsing, the GitHub client (against a mock), Open Food Facts conversion and the
sync engine (against an in-memory fake of the GitHub API). They do not cover the screens or iOS behaviour.

## Sync and the token

The app saves to the phone first and syncs to `morso-data` in the background through the GitHub REST API.
A fine-grained token limited to `morso-data` (Contents: read and write) is pasted once in Settings and is
stored only on the device; it is never in this repository. If you add a new JS file, also list it in
`sw.js` (a test checks this) so that it works offline.

## Icons

`npm run icons` regenerates the PNG icons from `tools/make-icons.mjs`.
