# Paddock Predictor 🏎️

Machine-learning predictions for every Formula 1 race, shown on a 3D claymorphism website.

The model ranks the whole grid and gives each driver a win and podium probability. It was back-tested race by race on 2024–2026 against the simplest baseline: drivers finish in grid order.

| Back-test (walk-forward) | 2024 | 2025 | 2026 so far |
|---|---|---|---|
| Winner correct (model / grid order) | 54% / 46% | 58% / 67% | 69% / 69% |
| Podium drivers named (model / grid order) | 67% / 67% | 78% / 75% | 65% / 63% |

## How it works

1. **Collect:** race and qualifying results since 2018 from the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1).
2. **Engineer:** 20 leak-free features per driver: grid, gap to pole, recent form, team pace, DNF rate, track history, standings.
3. **Train:** a LightGBM ranking model blended with logistic regression for the order; logistic models for calibrated win and podium odds. Recent seasons weigh more.
4. **Test:** every past race is predicted using only earlier races.

## Project layout

```
f1.py              command-line tool: evaluate / predict
export_site.py     retrains the model and writes site/data.json
f1predict/         data loading, features, models
site/              the website (index.html + data.json), deployed by Vercel
data/              cached API responses
vercel.json        tells Vercel to serve the site/ folder
```

## Run it locally

```bash
pip install -r requirements.txt
python f1.py predict                           # next race
python f1.py predict --season 2026 --round 10  # any race
python f1.py evaluate                          # back-test (~3 min)
python export_site.py                          # refresh the website data
python -m http.server 8765 --directory site    # view the site at http://localhost:8765
```

## Updating the live site

After each qualifying session or race, run `python export_site.py`, then commit and push. Vercel redeploys automatically.

Built with Python, pandas, scikit-learn, LightGBM, Three.js and GSAP. Fan project, not affiliated with Formula 1.
