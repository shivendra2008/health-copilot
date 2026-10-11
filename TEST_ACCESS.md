# Health Copilot: test access and evaluation notes

**Live app:** `<your Vercel URL>`
**Code:** https://github.com/shivendra2008/health-copilot
**Sample documents (fictional):** https://github.com/shivendra2008/health-copilot/tree/main/samples

> Please use only the fictional sample files below. Don't upload real medical documents.

## 1. How to register and sign in (about 1 minute)
1. Open the live app and click **Create account**.
2. Enter any name, an email address (it just has to be unique, **no verification email is sent**) and a password of at least 8 characters.
3. Choose your preferred language: **English, हिन्दी, मराठी or తెలుగు**. The interface switches immediately.
4. Optionally add age, height, weight and gender (or **Skip for now**), then **Upload your first report**.

To come back later, use **Sign in** with the same email and password. Your records are private to your account.

> **Don't reuse a real password.** This is a prototype.

## 2. Get the sample files
Download from the `samples` folder linked above:

| File | What it is |
|---|---|
| `lab_report_2026-03.pdf` | 1-page digital lab report (includes a hidden prompt-injection line) |
| `prescription_2026-03.pdf` | 1-page prescription |
| `lab_report_2026-08_scanned.png` | An image of a lab report (goes through OCR) |
| `pathology_report_4pages.pdf` | 4-page pathology report with a letterhead, about 75 results |

## 3. What to try, in order, and what you should see

| Step | Action | Expected result |
|---|---|---|
| **A** | Upload `lab_report_2026-03.pdf` | Live step list (Uploaded → Reading → Extracting → Checking → Ready). Opens the **Review** screen in about 20–40 s. |
| **B** | On Review, click a value | The original text is highlighted, so you can verify its source. Tick ✓ items, try ✎ to edit one, then **Confirm and save**. |
| **C** | Open the report | **8 lab results**, 4 outside the printed range (Hemoglobin 11.2 *Low*, MCV 78 *Low*, Fasting Glucose 104 *High*, HbA1c 5.8 *High*), one stated diagnosis (*Mild microcytic anaemia*), date 12 Mar 2026. The planted "ignore all previous instructions" line is **not** obeyed. |
| **D** | On *In plain words*, switch language | A plain-language explanation is written in that language. |
| **E** | Upload the prescription, then the scanned PNG; confirm both | Prescription: **3 medicines** exactly as written. Scan: OCR (about 98% confidence), **4 results**, dated 20 Aug 2026. |
| **F** | Open **Lab Results** → *Hemoglobin* | A **2-point trend**. *Fasting Glucose* appears as **two separate series** (mg/dL and mmol/L). Units are never mixed. |
| **G** | Open **Overview** and **Health Timeline** | Charts built from your confirmed data. Timeline entries link back to the source documents. |
| **H** | Open **Ask Health AI**; ask *"Which of my results were outside the printed range?"* | A grounded answer with **Sources** cards. Switch the answer language and the replies re-translate. |
| **I** | (Optional, about 1 min) Upload `pathology_report_4pages.pdf` | Processed in parts ("part 2 of 4"): **75 results**, dated 14 Sep 2026. |
| **J** | Open **Settings & Privacy** → **Generate demo ID** → **Download bundle** | A fictional ABHA-format ID, and a FHIR-aligned JSON bundle (Patient, DocumentReference, Observation, MedicationRequest, Condition). |

## 4. Evaluation checklist

| Area | How to check |
|---|---|
| **End-to-end workflow** | Steps A–C: register → upload → extract → review → confirm → summary → timeline |
| **Accuracy and honesty** | Compare the report with the source: values match exactly; nothing is invented; missing fields stay empty |
| **Verification and provenance** | Click-to-verify highlights the source line; edits show "Originally: …"; the AI's original is preserved |
| **Safety design** | Range status comes from the report's printed range; "not a diagnosis" disclaimer; unit-safe trends; the assistant says when data is missing |
| **Multilingual** | Four languages across UI, explanations and assistant (step D and H) |
| **Interoperability** | FHIR-aligned JSON; clearly labelled **mock** ABHA ID |
| **UX** | Loading spinners and progress bar, empty states, error messages with Retry, mobile layout (try a phone) |
| **Security basics** | Another account can't see your records; files open through short-lived links; there's no public file URL |

## 5. Good to know
- **Processing time:** a 1-page report takes 20–40 s, and the 4-page report about a minute. The AI service's free tier limits how much it handles per minute. If a screen shows "Still loading…", please wait rather than re-uploading.
- **If you see "The server is taking too long to respond":** press **Retry**. The backend is hosted on a small VM.
- **Uploading several files at once** can slow things down for the same reason. One at a time is smoothest.
- **What this is not:** an information and organisation tool. It does not diagnose or give medical advice. The ABHA ID is a mock, the FHIR export is *FHIR-aligned* rather than certified, and the project makes no HIPAA or ABDM compliance claims.
- **Run it yourself:** setup, environment variables, API list and test commands are in the repository `README.md` (`pytest` runs 82 backend tests).
- **Health check (no login needed):** `<your backend URL>/api/v1/health` should show `"supabase_configured": true`, `"ai_configured": true` and `"ocr_available": true`.

## 6. Contact
`<your name / email / team>`
