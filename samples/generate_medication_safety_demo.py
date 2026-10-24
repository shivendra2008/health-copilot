"""Generates the FICTIONAL prescription used to demo Medication Safety.

All names are invented. Run:
    python samples/generate_medication_safety_demo.py        (needs PyMuPDF)
The expected outcome for this prescription is in samples/medication_safety_demo.json and is asserted by
backend/tests/test_med_safety_demo.py, so the demo cannot silently drift from the rules.
"""
from pathlib import Path

import pymupdf

OUT = Path(__file__).parent / "prescription_medication_safety_demo.pdf"
LINES = [
    "City Demo Clinic (FICTIONAL)                         Date: 14/10/2026",
    "Patient: Asha Demo (FICTIONAL)     Age/Sex: 52 / F",
    "Dr. R. Example, MBBS",
    "",
    "Rx",
    "1. Tab Dolo 650 mg       1 tablet       1-1-1-1       x 3 days",
    "2. Tab Combiflam         1 tablet       TDS           x 3 days",
    "3. Tab Warfarin 5 mg     1 tablet       OD            x 30 days",
    "4. Tab Voveran 50 mg     1 tablet       BD            x 5 days",
    "5. Cap Zyxotab 20 mg     1 capsule      OD            x 10 days",
    "6. Tab Crocin            1 tablet       SOS",
    "",
    "Review after 1 week.",
]


def main() -> None:
    doc = pymupdf.open()
    p = doc.new_page(width=595, height=842)
    p.insert_text((50, 60), "PRESCRIPTION", fontsize=16, fontname="helv")
    y = 100
    for ln in LINES:
        p.insert_text((50, y), ln, fontsize=11, fontname="helv")
        y += 22
    p.insert_text((50, 810), "SAMPLE DOCUMENT - fictional data for software testing only", fontsize=8, fontname="helv")
    doc.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
