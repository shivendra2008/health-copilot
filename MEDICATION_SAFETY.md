# Medication Safety (prototype)

Decision support for a **user-confirmed** medicine list: duplicate active ingredients, a few curated drug–drug
interactions, brand ambiguity, and (only with complete data) a paracetamol daily-total check.
It is a hackathon prototype using a **small demo catalogue and ruleset**. It is not comprehensive, not clinically
certified, and does not replace a doctor or pharmacist.

## How it works
1. Upload a prescription → existing OCR/extraction → user reviews and confirms (unchanged).
2. **Check this prescription** (button on the record's Medicines section) copies the confirmed medicines into
   `confirmed_medications`. Current-use status starts as *Not sure*; nothing is assumed current.
3. The user edits details, marks fields *uncertain*, states whether each medicine is current, and resolves brands.
   A brand with several catalogue matches (e.g. "Dolo") is **ambiguous** until the user picks one; unknown brands are
   **unresolved**. Ingredients are never guessed from a brand name.
4. `POST /api/v1/medication-safety/check` runs the deterministic engine (no LLM) and saves a report.
5. The report shows severity (icon + word), status, medicines involved, rule id / source / review status / date,
   next step, unresolved medicines, missing information and limitations.
6. **Explain this report** asks the assistant to reword the *saved findings* in English/Hindi/Marathi/Telugu. Any answer
   containing a number that is not in the report is discarded in favour of a deterministic English text.

Document medication (`medications`), confirmed medication (`confirmed_medications`) and safety reviews
(`medication_safety_reports`) are separate tables. Safety code is isolated: a failure returns a clear 503 and cannot
affect upload, OCR, review, records or the assistant.

## Files
- Backend: `backend/app/services/med_safety/` (`catalogue.py`, `engine.py`, `dose.py`, `explain.py`, `data/catalogue.json`,
  `data/ruleset.json`), `backend/app/routers/medication_safety.py`, `backend/app/schemas/med_safety.py`.
- Database: `supabase/migrations/0004_medication_safety.sql`.
- Frontend: `frontend/src/app/(app)/medication-safety/**`, `components/app/med-editor.tsx`, `components/app/med-safety.tsx`,
  strings under `ms.*` in all four `lib/locales/*.ts`.
- Demo: `samples/prescription_medication_safety_demo.pdf`, `samples/medication_safety_demo.json`.

## Setup (manual — not done automatically)
1. Run `supabase/migrations/0004_medication_safety.sql` in the Supabase SQL editor (after 0001–0003).
   Until then the safety endpoints return `503 medication_safety_not_ready`; the rest of the app is unaffected.
2. Redeploy the backend (`TUNNEL_TOKEN=unused ./deploy.sh quick` on this VM) and redeploy the frontend on Vercel.

## Demo
Upload `samples/prescription_medication_safety_demo.pdf`, confirm the extracted medicines, open **Check this prescription**.
Expected (see `medication_safety_demo.json`, asserted by `backend/tests/test_med_safety_demo.py`):
- Dolo 650 + Combiflam → duplicate **paracetamol** (high).
- Combiflam (ibuprofen) + Voveran (diclofenac) → two **NSAIDs** (high).
- Warfarin + Combiflam, Warfarin + Voveran → **bleeding-risk interaction** (high), two findings.
- Crocin → **ambiguous** (500 mg or 650 mg?) until chosen; Zyxotab → **not in catalogue**. Both are excluded from checks and listed as *Needs confirmation*.
- No dose finding (3,575 mg/day paracetamol is under the 4,000 mg limit) and no "safe" message.

## Tests
```
cd backend && python -m pytest -q          # needs pytest, httpx, jsonschema (requirements-dev.txt)
cd frontend && npx tsc --noEmit && npx eslint src && npm run build
```

## Known limitations / needs human review
- **Every rule is `pending_pharmacist_review`.** Source citations are generic references to public product labelling and
  must be verified by a pharmacist before any real use. Brand compositions in the catalogue were curated from general
  knowledge and are not verified against the Indian market.
- ~17 generics, ~20 brand variants and 8 interaction rules; many real interactions are not covered.
- The dose check covers paracetamol only, adults only (age from the profile), mg only, and only with parseable
  strength/dose/frequency. Units are never converted.
- The assistant explains a saved report on request; free-form assistant chat does not read safety reports.
- Frontend flows were compiled and type-checked but not exercised in a browser with a real account.
