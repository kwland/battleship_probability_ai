# Battleship Probability AI — Web Demo

A static, client-side-only site (plain HTML/CSS/JS, no build step, no backend)
that lets you play against the probability-density hunt/target AI from the
Python version of this project, watch its live "heatmap" of likely ship
cells, and benchmark it against a random-shot baseline.

## Files

- `index.html` — page structure
- `style.css` — styling (dark/light aware)
- `ai.js` — JS port of the AI logic (`RandomAI`, `ProbabilityAI`, `PlacementAI`)
- `app.js` — game state and UI wiring

## Run locally

Any static file server works, e.g.:

```
python -m http.server 8765
```

then open `http://localhost:8765`.

## Deploy to GitHub Pages

1. Commit these files to a GitHub repo (either at the repo root, or in a
   `docs/` folder, or on their own branch — whatever matches your Pages
   source setting).
2. In the repo: **Settings → Pages → Source**, pick the branch/folder these
   files live in.
3. Save. GitHub will publish it at `https://<username>.github.io/<repo>/`.

No further configuration is needed — everything runs in the browser.
