"""Evaluate extraction accuracy against manually verified samples.

    cd backend && .venv/bin/python -m scripts.eval_extraction [../samples]

Always runs text extraction (PyMuPDF / PaddleOCR). If GROQ_API_KEY is set, also
runs the structured extraction + validation and scores it against expected.json.
"""
import json
import sys
from pathlib import Path

from app.config import get_settings
from app.schemas.extraction import ExtractionData, LLMExtraction, LLM_EXTRACTION_JSON_SCHEMA
from app.services.clinical_rules import normalize_test_name, parse_value
from app.services.files import validate_upload
from app.services.groq_client import LLMError, chat_json
from app.services.prompts import EXTRACTION_SYSTEM, extraction_user
from app.services.text_extraction import extract_text
from app.services.validation import assign_keys, validate


def main(folder: Path):
    expected = json.loads((folder / "expected.json").read_text())
    use_llm = get_settings().groq_configured
    totals = {"expected": 0, "found": 0, "exact": 0, "extra": 0, "meds_expected": 0, "meds_found": 0, "type_ok": 0, "date_ok": 0}
    for name, exp in expected.items():
        data = (folder / name).read_bytes()
        vf = validate_upload(name, None, data)
        ext = extract_text(data, vf.mime_type)
        conf = f"{ext.ocr_confidence:.3f}" if ext.ocr_confidence is not None else "-"
        print(f"\n== {name}  [{ext.method}, ocr_conf={conf}, chars={len(ext.text)}]")
        if not use_llm:
            print("   (GROQ_API_KEY not set: skipping structured extraction)")
            continue
        try:
            raw, model = chat_json(EXTRACTION_SYSTEM, extraction_user(ext.text, name), "medical_document_extraction", LLM_EXTRACTION_JSON_SCHEMA, max_tokens=6000)
        except LLMError as e:
            print("   LLM error:", e.code, e.message)
            continue
        d = assign_keys(ExtractionData.model_validate(LLMExtraction.model_validate(raw).model_dump()))
        issues = validate(d, ext.text, ext.ocr_confidence)
        got = {normalize_test_name(r.test_name): r.value for r in d.lab_results}
        totals["type_ok"] += d.document_type == exp["document_type"]
        totals["date_ok"] += d.document_date == exp["document_date"]
        for test, val in exp["lab_results"].items():
            totals["expected"] += 1
            g = got.get(normalize_test_name(test))
            if g is not None:
                totals["found"] += 1
                if parse_value(g).number == parse_value(val).number:
                    totals["exact"] += 1
                else:
                    print(f"   MISMATCH {test}: expected {val}, got {g}")
            else:
                print(f"   MISSING  {test}")
        exp_names = {normalize_test_name(t) for t in exp["lab_results"]}
        extra = [t for t in got if t not in exp_names]
        totals["extra"] += len(extra)
        if extra:
            print("   EXTRA (not in expected):", extra)
        meds = [m.name.lower() for m in d.medications]
        totals["meds_expected"] += len(exp["medications"])
        totals["meds_found"] += sum(any(e.lower() in m for m in meds) for e in exp["medications"])
        print(f"   type={d.document_type} date={d.document_date} labs={len(d.lab_results)} meds={len(d.medications)} "
              f"conditions={[c.description for c in d.conditions]} issues={[i['code'] for i in issues]} model={model}")
    if use_llm and totals["expected"]:
        print("\n== SUMMARY")
        print(f"   lab recall      {totals['found']}/{totals['expected']}")
        print(f"   value accuracy  {totals['exact']}/{totals['found']}")
        print(f"   extra tests     {totals['extra']}")
        print(f"   medications     {totals['meds_found']}/{totals['meds_expected']}")
        print(f"   doc type        {totals['type_ok']}/{len(expected)}   date {totals['date_ok']}/{len(expected)}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "../samples"))
