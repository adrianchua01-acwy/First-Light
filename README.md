# First Light

Tells a beginner when, where and how to photograph nebulae and the Milky Way, from anywhere in the world.

Open `index.html` in a browser. There is nothing to install and no account or key.
"Use my location" may need the app to be served rather than opened as a file:

    python -m http.server 8765

then visit http://localhost:8765.

| File | What it does |
|---|---|
| `js/astro.js` | Sun, Moon and star positions, time zones |
| `js/catalog.js` | Targets, bright stars, offline places. Add a target here |
| `js/planner.js` | Photo score, best window, reasons |
| `js/sky.js` | Sky window and night chart |
| `js/app.js` | Interface |
| `tests.html` | Open it to run the tests |

Place search and cloud forecasts (about 16 days) come from open-meteo.com. Without internet, everything except
cloud and online search still works. Settings and saved plans stay in the browser.

The score multiplies five factors: darkness, height, moonlight, sky glow and cloud. The weights are rule-of-thumb
estimates, not measurements, and are all near the top of `planner.js`.
