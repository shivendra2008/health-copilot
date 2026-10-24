# Prescription Safety Checker (prototype)

Type or paste a prescription and get a plain-language answer: what is inside each brand, what the short forms
(OD, BD, TDS, AC, SOS ...) mean, and what to watch out for. Everything is **deterministic** (no AI decides a finding)
and runs on a **small demo catalogue and ruleset**. It is not comprehensive, not clinically certified, and does not
replace a doctor or pharmacist.

## What the user sees (one page: `/medication-safety`)
1. **Type the prescription**, one medicine per line (`Tab Dolo 650 mg 1-0-1 x 5 days`). "Try an example" fills a demo.
2. **Tell us about the patient**: age, weight, kidney function. Each is optional; unknown stays unknown.
3. **Read the result**:
   - a headline in plain words (needs attention / worth knowing / nothing flagged, never "safe");
   - **"We need your help"** for misspelled or ambiguous brands: tap the right suggestion or leave it out;
   - alerts in importance tiers (**Needs attention** open; **Worth knowing** and **Good to know** collapsed) to avoid alert fatigue;
   - **what is inside each medicine** (all ingredients and strengths, combination products spelled out) and how it is taken,
     with abbreviations decoded (`TDS: Three times a day`, `1-0-1: Morning 1 · Afternoon 0 · Night 1`, `AC: Before food`);
   - **daily totals per ingredient** across all medicines (the hidden-duplicate case, e.g. two brands with paracetamol);
   - missing information that would make the check more accurate.
   A "What do OD, BD, TDS, AC mean?" guide is always on the page. From an uploaded prescription, **Check these medicines for
   safety** opens the same page pre-filled.
4. **Save this report** (optional) stores it and unlocks "Explain this report" in English, Hindi, Marathi or Telugu.

## The four challenges in the problem statement
| Challenge | How it is handled |
|---|---|
| Misspelled brand names | Fuzzy match → a "Did you mean…?" list. A suggestion is **never applied automatically**. |
| Ingredients in combination products | Every catalogue entry lists all active ingredients with strengths (Combiflam, Sumo, Zerodol-P, Augmentin ...). |
| Patient-specific dose limits | Paracetamol (adult, adult < 50 kg, child by weight), ibuprofen and diclofenac daily limits; kidney rules for metformin, NSAIDs, spironolactone. Missing age/weight is reported, never assumed. |
| Alert fatigue | Tiers + serious items first; informational notices collapsed; one card per issue with the source tucked behind a link. |

## Files
- Backend: `backend/app/services/med_safety/` (`parser.py`, `catalogue.py`, `engine.py`, `analysis.py`, `dose.py`, `explain.py`,
  `data/catalogue.json`, `data/ruleset.json`), `backend/app/routers/medication_safety.py`, `backend/app/schemas/med_safety.py`.
- Endpoints: `POST /api/v1/medication-safety/parse`, `/analyze` (both stateless, nothing stored), `/reports/save`
  (recomputes on the server), `GET /reports`, `GET/DELETE /reports/{id}`, `POST /reports/{id}/explain`, `GET /medicines/search`,
  `POST /resolve-brand`. The older confirmed-medication endpoints (`/confirmed-medications*`, `/check`) still exist and are tested, but
  the UI no longer uses them.
- Database (only needed for **saving** reports): `supabase/migrations/0004_medication_safety.sql`, then `0005_medication_safety_typed.sql`.
  Both are safe to run more than once. Checking works without them.
- Frontend: `frontend/src/app/(app)/medication-safety/**`, `components/app/{rx-result,rx-glossary,med-safety}.tsx`, strings under `ms.*`
  in all four locales.
- Demo: `samples/prescription_medication_safety_demo.pdf`, `samples/medication_safety_demo.json` (asserted by a test).

## Setup (manual, not done automatically)
1. (Optional, for saving) run `0004` then `0005` in the Supabase SQL editor.
2. Redeploy the backend, then the frontend (merge to `main` for Vercel).

## Tests
```
cd backend && python -m pytest -q        # needs pytest, jsonschema (requirements-dev.txt)
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
```

## Known limitations / needs human review
- **Every rule is `pending_pharmacist_review`.** Citations are generic references to public product labelling and must be
  verified by a pharmacist. Brand compositions were curated from general knowledge and are not verified against the Indian market.
- ~19 generics, ~25 brand variants, 8 interaction rules, 5 dose rules, 3 kidney rules. Many real interactions are not covered.
- A dose per time that is not written (`Tab X BD` without "1 tab") is **reported as missing, not assumed to be one tablet**.
- Dose limits: mg only (no unit conversion); no pregnancy, liver or elderly-specific rules; children only for paracetamol (needs weight).
- Free-form assistant chat does not read safety reports; only "Explain this report" does.
- The UI was compiled and type-checked but not exercised in a browser with a real account.
