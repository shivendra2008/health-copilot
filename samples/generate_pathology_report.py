"""Generates a FICTIONAL four-page pathology report (with letterhead) for demos and testing.

Everything here is invented: the laboratory, people, IDs and values. Run:
    backend/.venv/bin/python samples/generate_pathology_report.py
"""
from pathlib import Path

import pymupdf

OUT = Path(__file__).parent / "pathology_report_4pages.pdf"

W, H = 595, 842
M = 40  # page margin
GREEN = (0.114, 0.42, 0.314)
INK = (0.125, 0.16, 0.137)
MUTED = (0.38, 0.42, 0.40)
RED = (0.70, 0.13, 0.09)
LINE = (0.80, 0.84, 0.82)
BAND = (0.955, 0.97, 0.96)

LAB = "MERIDIAN PATHOLOGY LABORATORY"
LAB_TAG = "Clinical Pathology  |  Haematology  |  Biochemistry  |  Immunoassay"
LAB_ADDR = "Plot 14, Road No. 3, Banjara Hills, Hyderabad - 500034, Telangana"
LAB_CONTACT = "Ph: 040 0000 1234  |  care@meridian-demo.example  |  www.meridian-demo.example"

PATIENT = {
    "Patient Name": "Ms. ANANYA DEMO (FICTIONAL)",
    "Age / Sex": "38 Years / Female",
    "Patient ID": "MPL-2026-004817",
    "Referred By": "Dr. S. Rao, MD (General Medicine)",
    "Lab ID": "260914-0372",
    "Sample Collected": "14/09/2026  07:45 AM",
    "Sample Received": "14/09/2026  08:20 AM",
    "Report Released": "14/09/2026  04:10 PM",
}
REPORT_ID = "MPL/26/09/0372"
TOTAL_PAGES = 4


def tw(text, font, size):
    return pymupdf.get_text_length(text, fontname=font, fontsize=size)


class Pdf:
    def __init__(self):
        self.doc = pymupdf.open()
        self.page = None
        self.y = 0.0
        self.n = 0

    # ---- primitives ---------------------------------------------------------------------
    def text(self, x, y, s, size=9, font="helv", color=INK, align="l"):
        if align == "r":
            x -= tw(s, font, size)
        elif align == "c":
            x -= tw(s, font, size) / 2
        self.page.insert_text((x, y), s, fontname=font, fontsize=size, color=color)

    def rule(self, y, x0=M, x1=W - M, width=0.6, color=LINE):
        self.page.draw_line((x0, y), (x1, y), color=color, width=width)

    def rect(self, x0, y0, x1, y1, fill=None, stroke=None, width=0.6):
        self.page.draw_rect(pymupdf.Rect(x0, y0, x1, y1), color=stroke, fill=fill, width=width)

    # ---- page furniture -----------------------------------------------------------------
    def logo(self, x, y, s=44):
        # simple mark: rounded green square with a white cross and a drop
        self.page.draw_rect(pymupdf.Rect(x, y, x + s, y + s), color=None, fill=GREEN, radius=0.2)
        cx, cy, a = x + s / 2, y + s / 2, s * 0.15
        self.page.draw_rect(pymupdf.Rect(cx - a, cy - s * 0.3, cx + a, cy + s * 0.3), color=None, fill=(1, 1, 1))
        self.page.draw_rect(pymupdf.Rect(cx - s * 0.3, cy - a, cx + s * 0.3, cy + a), color=None, fill=(1, 1, 1))

    def new_page(self, first=False):
        self.page = self.doc.new_page(width=W, height=H)
        self.n += 1
        if first:
            self.logo(M, 36)
            self.text(M + 58, 58, LAB, 18, "hebo", GREEN)
            self.text(M + 58, 73, LAB_TAG, 8, "helv", MUTED)
            self.text(M + 58, 85, LAB_ADDR, 8, "helv", INK)
            self.text(M + 58, 96, LAB_CONTACT, 8, "helv", INK)
            self.text(W - M, 52, "REG. NO. DEMO/TS/PL/0001", 7.5, "hebo", MUTED, "r")
            self.text(W - M, 63, "(fictional laboratory)", 7, "heit", MUTED, "r")
            self.rect(M, 108, W - M, 111, fill=GREEN)
            self.y = 128
            self.title("LABORATORY INVESTIGATION REPORT")
            self.patient_block()
        else:
            self.logo(M, 30, 26)
            self.text(M + 34, 44, LAB, 10.5, "hebo", GREEN)
            self.text(M + 34, 55, "Laboratory Investigation Report (continued)", 7.5, "helv", MUTED)
            self.text(W - M, 40, "Patient: ANANYA DEMO (FICTIONAL)   38 Y / F", 8, "hebo", INK, "r")
            self.text(W - M, 52, f"Patient ID: {PATIENT['Patient ID']}    Lab ID: {PATIENT['Lab ID']}", 8, "helv", MUTED, "r")
            self.rect(M, 64, W - M, 66, fill=GREEN)
            self.y = 84
        self.footer()

    def footer(self):
        self.rule(H - 52, width=0.8)
        self.text(M, H - 40, f"Report ID: {REPORT_ID}", 7.5, "helv", MUTED)
        self.text(W / 2, H - 40, f"Page {self.n} of {TOTAL_PAGES}", 8, "hebo", INK, "c")
        self.text(W - M, H - 40, "Printed 14/09/2026  04:12 PM", 7.5, "helv", MUTED, "r")
        self.text(W / 2, H - 28, "FICTIONAL SAMPLE REPORT - generated for software testing only. Not a real laboratory report.",
                  7, "heit", RED, "c")

    # ---- blocks -------------------------------------------------------------------------
    def title(self, s):
        self.text(W / 2, self.y, s, 12, "hebo", INK, "c")
        self.y += 14

    def patient_block(self):
        top = self.y
        self.rect(M, top, W - M, top + 78, fill=BAND, stroke=LINE)
        items = list(PATIENT.items())
        col_x = [M + 10, M + 262]
        for i, (k, v) in enumerate(items):
            col, row = divmod(i, 4)
            x = col_x[col]
            y = top + 17 + row * 17
            self.text(x, y, k, 8, "helv", MUTED)
            self.text(x + 82, y, f":  {v}", 8.5, "hebo" if k == "Patient Name" else "helv", INK)
        self.y = top + 92

    def section(self, title, specimen=None):
        self.y += 20
        self.rect(M, self.y - 11, W - M, self.y + 5, fill=GREEN)
        self.text(M + 6, self.y, title.upper(), 9.5, "hebo", (1, 1, 1))
        if specimen:
            self.text(W - M - 6, self.y, f"Specimen: {specimen}", 7.5, "heit", (1, 1, 1), "r")
        self.y += 12
        self.header_row()

    COLS = {"test": M + 6, "result": 238, "flag": 300, "unit": 322, "ref": 392, "method": 492}

    def header_row(self):
        self.rule(self.y - 2, width=0.4)
        for key, label in (("test", "TEST"), ("result", "RESULT"), ("flag", "FLAG"), ("unit", "UNIT"),
                           ("ref", "REFERENCE INTERVAL"), ("method", "METHOD")):
            self.text(self.COLS[key], self.y + 8, label, 7, "hebo", MUTED)
        self.y += 12
        self.rule(self.y, width=0.5)
        self.y += 3

    def row(self, test, result, unit="", ref="", flag="", method="", sub=False, band=False):
        h = 15
        if band:
            self.rect(M, self.y, W - M, self.y + h, fill=BAND)
        base = self.y + 10.5
        self.text(self.COLS["test"] + (10 if sub else 0), base, test, 8.5, "helv", INK)
        abnormal = flag in ("H", "L")
        self.text(self.COLS["result"], base, result, 8.5, "hebo" if abnormal else "helv", RED if abnormal else INK)
        if flag:
            self.text(self.COLS["flag"], base, flag, 8.5, "hebo", RED)
        self.text(self.COLS["unit"], base, unit, 8, "helv", INK)
        self.text(self.COLS["ref"], base, ref, 8, "helv", INK)
        self.text(self.COLS["method"], base, method, 7, "heit", MUTED)
        self.y += h

    def rows(self, items):
        for i, it in enumerate(items):
            self.row(*it[:6], sub=len(it) > 6 and it[6], band=i % 2 == 1)

    def note(self, lines, title="Interpretation / Comments"):
        self.y += 14
        self.text(M + 2, self.y, title, 8, "hebo", GREEN)
        self.y += 11
        for ln in lines:
            self.text(M + 2, self.y, ln, 7.8, "heit", INK)
            self.y += 10.5
        self.y += 2

    def check(self, limit=H - 62):
        assert self.y < limit, f"page {self.n} overflow (y={self.y:.0f})"


def build():
    p = Pdf()

    # ============================ PAGE 1: CBC + glycaemic status ============================
    p.new_page(first=True)
    p.section("Haematology - Complete Blood Count (CBC)", "Whole blood, EDTA")
    p.rows([
        ("Haemoglobin (Hb)", "11.8", "g/dL", "12.0 - 15.5", "L", "Photometry"),
        ("Total RBC Count", "4.31", "million/cumm", "3.80 - 4.80", "", "Impedance"),
        ("Packed Cell Volume (PCV)", "35.9", "%", "36.0 - 46.0", "L", "Calculated"),
        ("Mean Corpuscular Volume (MCV)", "83.3", "fL", "80.0 - 100.0", "", "Calculated"),
        ("Mean Corpuscular Hb (MCH)", "27.4", "pg", "27.0 - 32.0", "", "Calculated"),
        ("Mean Corpuscular Hb Conc. (MCHC)", "32.9", "g/dL", "31.5 - 34.5", "", "Calculated"),
        ("Red Cell Distribution Width (RDW-CV)", "14.9", "%", "11.6 - 14.0", "H", "Calculated"),
        ("Total Leucocyte Count (TLC)", "7,450", "cells/cumm", "4,000 - 11,000", "", "Impedance"),
    ])
    p.y += 3
    p.text(M + 6, p.y + 8, "Differential Leucocyte Count (DLC)", 8, "hebo", MUTED)
    p.y += 12
    p.rows([
        ("Neutrophils", "58", "%", "40 - 75", "", "Flow cytometry", True),
        ("Lymphocytes", "33", "%", "20 - 45", "", "Flow cytometry", True),
        ("Eosinophils", "6", "%", "1 - 6", "", "Flow cytometry", True),
        ("Monocytes", "3", "%", "2 - 10", "", "Flow cytometry", True),
        ("Basophils", "0", "%", "0 - 1", "", "Flow cytometry", True),
        ("Absolute Neutrophil Count", "4,321", "cells/cumm", "2,000 - 7,000", "", "Calculated", True),
        ("Absolute Lymphocyte Count", "2,459", "cells/cumm", "1,000 - 3,000", "", "Calculated", True),
    ])
    p.y += 3
    p.rows([
        ("Platelet Count", "2.74", "lakhs/cumm", "1.50 - 4.10", "", "Impedance"),
        ("Mean Platelet Volume (MPV)", "9.8", "fL", "7.5 - 11.5", "", "Calculated"),
        ("Erythrocyte Sedimentation Rate (ESR)", "28", "mm/1st hr", "0 - 20", "H", "Westergren"),
    ])
    p.note([
        "Mild reduction in haemoglobin and PCV with raised RDW. Clinical correlation and iron studies are suggested.",
        "ESR is a non-specific marker of inflammation; interpret together with clinical findings.",
    ])
    p.section("Biochemistry - Glycaemic Status", "Plasma (fluoride) / Whole blood EDTA")
    p.rows([
        ("Fasting Plasma Glucose (FPG)", "108", "mg/dL", "70 - 100", "H", "Hexokinase"),
        ("Post-Prandial Plasma Glucose (PPG)", "142", "mg/dL", "70 - 140", "H", "Hexokinase"),
        ("Glycosylated Haemoglobin (HbA1c)", "6.1", "%", "4.0 - 5.6", "H", "HPLC"),
        ("Estimated Average Glucose (eAG)", "128", "mg/dL", "-", "", "Calculated"),
    ])
    p.check()

    # ============================ PAGE 2: lipids, liver, kidney =============================
    p.new_page()
    p.note([
        "HbA1c reference as per the laboratory: Normal < 5.7 %, Pre-diabetes 5.7 - 6.4 %, Diabetes >= 6.5 %.",
        "Diagnosis of diabetes should not be made on a single laboratory value alone.",
    ], title="Interpretation / Comments - Glycaemic Status (continued)")
    p.y -= 6
    p.section("Biochemistry - Lipid Profile", "Serum, 12-hour fasting")
    p.rows([
        ("Total Cholesterol", "214", "mg/dL", "< 200", "H", "CHOD-PAP"),
        ("Triglycerides", "168", "mg/dL", "< 150", "H", "GPO-PAP"),
        ("HDL Cholesterol", "46", "mg/dL", "> 50", "L", "Direct enzymatic"),
        ("LDL Cholesterol (Direct)", "134", "mg/dL", "< 100", "H", "Direct enzymatic"),
        ("VLDL Cholesterol", "33.6", "mg/dL", "< 30", "H", "Calculated"),
        ("Non-HDL Cholesterol", "168", "mg/dL", "< 130", "H", "Calculated"),
        ("Total Cholesterol / HDL Ratio", "4.7", "", "< 5.0", "", "Calculated"),
        ("LDL / HDL Ratio", "2.9", "", "< 3.5", "", "Calculated"),
    ])
    p.note(["Target values depend on individual cardiovascular risk. Please discuss with your physician."])
    p.section("Biochemistry - Liver Function Test (LFT)", "Serum")
    p.rows([
        ("Total Bilirubin", "0.7", "mg/dL", "0.3 - 1.2", "", "Diazo"),
        ("Direct Bilirubin", "0.2", "mg/dL", "0.0 - 0.3", "", "Diazo"),
        ("Indirect Bilirubin", "0.5", "mg/dL", "0.1 - 1.0", "", "Calculated"),
        ("AST (SGOT)", "31", "U/L", "5 - 34", "", "IFCC"),
        ("ALT (SGPT)", "38", "U/L", "0 - 35", "H", "IFCC"),
        ("Alkaline Phosphatase (ALP)", "96", "U/L", "40 - 129", "", "IFCC"),
        ("Gamma GT (GGT)", "24", "U/L", "6 - 42", "", "IFCC"),
        ("Total Protein", "7.2", "g/dL", "6.4 - 8.3", "", "Biuret"),
        ("Albumin", "4.1", "g/dL", "3.5 - 5.2", "", "BCG"),
        ("Globulin", "3.1", "g/dL", "2.0 - 3.5", "", "Calculated"),
        ("Albumin / Globulin Ratio", "1.3", "", "1.0 - 2.1", "", "Calculated"),
    ])
    p.section("Biochemistry - Kidney Function Test (KFT)", "Serum")
    p.rows([
        ("Blood Urea", "24", "mg/dL", "17 - 43", "", "Urease-GLDH"),
        ("Serum Creatinine", "0.78", "mg/dL", "0.55 - 1.02", "", "Jaffe kinetic"),
        ("eGFR (CKD-EPI 2021)", "98", "mL/min/1.73 m2", "> 90", "", "Calculated"),
        ("Uric Acid", "5.4", "mg/dL", "2.6 - 6.0", "", "Uricase"),
    ])
    p.check()

    # ============================ PAGE 3: electrolytes, iron, thyroid, vitamins =============
    p.new_page()
    p.section("Biochemistry - Minerals and Electrolytes", "Serum")
    p.rows([
        ("Calcium, Total", "9.3", "mg/dL", "8.6 - 10.0", "", "Arsenazo III"),
        ("Phosphorus", "3.6", "mg/dL", "2.5 - 4.5", "", "Molybdate"),
        ("Sodium (Na+)", "139", "mmol/L", "136 - 145", "", "ISE indirect"),
        ("Potassium (K+)", "4.3", "mmol/L", "3.5 - 5.1", "", "ISE indirect"),
        ("Chloride (Cl-)", "103", "mmol/L", "98 - 107", "", "ISE indirect"),
    ])
    p.section("Iron Studies", "Serum")
    p.rows([
        ("Serum Iron", "48", "ug/dL", "50 - 170", "L", "Ferrozine"),
        ("Total Iron Binding Capacity (TIBC)", "412", "ug/dL", "250 - 425", "", "Ferrozine"),
        ("Transferrin Saturation", "11.7", "%", "15 - 50", "L", "Calculated"),
        ("Serum Ferritin", "11", "ng/mL", "13 - 150", "L", "CLIA"),
    ])
    p.note(["Low iron and ferritin with reduced transferrin saturation are consistent with depleted iron stores."])
    p.section("Immunoassay - Thyroid Profile", "Serum")
    p.rows([
        ("Thyroid Stimulating Hormone (TSH)", "5.62", "uIU/mL", "0.35 - 4.94", "H", "CLIA"),
        ("Free Triiodothyronine (Free T3)", "3.1", "pg/mL", "2.0 - 4.4", "", "CLIA"),
        ("Free Thyroxine (Free T4)", "1.05", "ng/dL", "0.70 - 1.48", "", "CLIA"),
    ])
    p.section("Immunoassay - Vitamins", "Serum")
    p.rows([
        ("25-OH Vitamin D (Total)", "18.4", "ng/mL", "30.0 - 100.0", "L", "CLIA"),
        ("Vitamin B12 (Cyanocobalamin)", "198", "pg/mL", "211 - 911", "L", "CLIA"),
    ])
    p.note(["Vitamin D: Deficiency < 20 ng/mL, Insufficiency 20 - 29 ng/mL, Sufficiency 30 - 100 ng/mL."])
    p.check()

    # ============================ PAGE 4: urine + sign-off ==================================
    p.new_page()
    p.section("Clinical Pathology - Urine Routine Examination", "Random urine, mid-stream")
    p.rows([
        ("Colour", "Pale yellow", "", "Pale yellow", "", "Visual"),
        ("Appearance", "Clear", "", "Clear", "", "Visual"),
        ("pH", "6.0", "", "5.0 - 8.0", "", "Reflectance"),
        ("Specific Gravity", "1.015", "", "1.005 - 1.030", "", "Reflectance"),
        ("Protein", "Negative", "", "Negative", "", "Reflectance"),
        ("Glucose", "Negative", "", "Negative", "", "Reflectance"),
        ("Ketones", "Negative", "", "Negative", "", "Reflectance"),
        ("Blood", "Negative", "", "Negative", "", "Reflectance"),
        ("Bilirubin", "Negative", "", "Negative", "", "Reflectance"),
        ("Urobilinogen", "Normal", "", "Normal", "", "Reflectance"),
        ("Nitrite", "Negative", "", "Negative", "", "Reflectance"),
        ("Leucocyte Esterase", "Negative", "", "Negative", "", "Reflectance"),
    ])
    p.y += 3
    p.text(M + 6, p.y + 8, "Microscopic Examination", 8, "hebo", MUTED)
    p.y += 12
    p.rows([
        ("Pus Cells", "2 - 3", "/HPF", "0 - 5", "", "Microscopy", True),
        ("Red Blood Cells", "Nil", "/HPF", "Nil", "", "Microscopy", True),
        ("Epithelial Cells", "1 - 2", "/HPF", "Occasional", "", "Microscopy", True),
        ("Casts / Crystals / Bacteria", "Nil", "", "Nil", "", "Microscopy", True),
    ])
    p.y += 26
    p.text(W / 2, p.y, "*** End of Report ***", 9, "hebo", INK, "c")
    p.y += 30
    p.rule(p.y + 28, M, M + 150, 0.7, INK)
    p.rule(p.y + 28, W - M - 170, W - M, 0.7, INK)
    p.text(M, p.y + 40, "Medical Lab Technologist", 8, "hebo", INK)
    p.text(M, p.y + 51, "Verified electronically", 7.5, "heit", MUTED)
    p.text(W - M, p.y + 40, "Dr. R. KAMALA DEMO, MD (Pathology)", 8, "hebo", INK, "r")
    p.text(W - M, p.y + 51, "Consultant Pathologist (fictional)", 7.5, "heit", MUTED, "r")
    p.y += 78
    p.text(M, p.y, "Conditions of reporting", 7.5, "hebo", MUTED)
    p.y += 10
    for ln in (
        "1. Results relate only to the sample tested. 2. Reference intervals are specific to this laboratory and method.",
        "3. Please correlate clinically; a single result should not be used in isolation to make a diagnosis.",
        "4. This is a fictional document with invented data, created to test health-record software.",
    ):
        p.text(M, p.y, ln, 7, "helv", MUTED)
        p.y += 9
    p.check()

    assert p.n == TOTAL_PAGES, p.n
    p.doc.set_metadata({"title": "Pathology report (FICTIONAL SAMPLE)", "author": "Meridian Pathology Laboratory (fictional)",
                        "subject": "Sample document for software testing"})
    p.doc.save(OUT, garbage=3, deflate=True)
    print("Wrote", OUT, f"({OUT.stat().st_size // 1024} KB, {p.n} pages)")


if __name__ == "__main__":
    build()
