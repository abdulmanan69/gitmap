# Contributing to GitMap

Thanks for helping. GitMap is deliberately small: plain ES modules, D3 from a CDN, no build step.

## Run it locally

```bash
npm start            # serves ./ on http://localhost:5173 (uses npx serve)
# or
python -m http.server 5173
```

Open `http://localhost:5173`. Any static server works, the only requirement is that files are served over HTTP so ES modules load.

## Tests

```bash
npm test             # node --test tests/
npm run check        # node --check on every module
```

Model code (`src/model`, `src/api/github.js`, `src/utils/format.js`) is DOM-free and covered by tests. Views are exercised in the browser.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/api/github.js` | REST client, caching, rate-limit tracking, input parsing |
| `src/model/tree.js` | Hierarchy, stats, pruning, health checks, exports |
| `src/model/languages.js` | Extension → language map with Linguist colours |
| `src/model/deps.js` | Manifest discovery and parsers for 11 ecosystems |
| `src/views/*.js` | One module per tab, each exports `{ id, label, key, icon, mount() }` |
| `src/ui/*.js` | Hero canvas, loader, toast, tooltip, inspector, theme |
| `styles/*.css` | Tokens (`base.css`), components, per-view styles |

## Adding a view

1. Create `src/views/<name>.js` exporting `{ id, label, key, icon, mount(container, ctx) }`.
2. `mount` returns `{ unmount(), svg() }` and optionally `focusPath(path)` / `focusSearch()`.
3. Register it in the `VIEWS` array in `src/main.js`.

## Pull requests

- Keep the zero-dependency, zero-build constraint.
- Run `npm run check && npm test` before pushing.
- Screenshots or a short clip help for visual changes.
