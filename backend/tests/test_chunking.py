from app.schemas.extraction import LLMExtraction
from app.services.extraction import make_chunks, merge, split_pages


def _text(pages):
    return "\n\n".join(f"--- Page {i} ---\n{body}" for i, body in enumerate(pages, 1))


def test_split_pages_keeps_markers_and_order():
    parts = split_pages(_text(["alpha", "beta", "gamma"]))
    assert [p.splitlines()[0] for p in parts] == ["--- Page 1 ---", "--- Page 2 ---", "--- Page 3 ---"]
    assert split_pages("no markers here") == ["no markers here"]


def test_chunks_group_pages_without_splitting_them_and_respect_size():
    pages = [("row %d\n" % i) * 40 for i in range(6)]          # ~ 300 chars each
    chunks = make_chunks(_text(pages), 700)
    assert 2 <= len(chunks) <= 6
    assert all(len(c) <= 700 + 100 for c in chunks)
    assert "".join(chunks).count("--- Page") == 6              # nothing lost
    assert make_chunks("short text", 6500) == ["short text"]


def test_oversized_single_page_is_split_on_line_boundaries():
    big = "\n".join(f"Test {i} 1.{i} mg/dL" for i in range(200))
    chunks = make_chunks("--- Page 1 ---\n" + big, 1000)
    assert len(chunks) > 1 and all(len(c) <= 1100 for c in chunks)
    assert sum(c.count("Test ") for c in chunks) == 200


def _llm(**over):
    base = dict(document_type="lab_report", classification_confidence="high", document_date=None, facility=None, clinician=None,
                lab_results=[], medications=[], conditions=[], procedures=[], follow_ups=[], findings=[])
    return LLMExtraction.model_validate(base | over)


def _lab(name, value, unit="mg/dL", rng="1 - 2"):
    return dict(test_name=name, value=value, unit=unit, reference_range=rng, flag=None, category=None,
                source_text=f"{name} {value}", confidence="high")


def test_merge_takes_header_from_first_chunk_that_has_it_and_dedupes():
    a = _llm(document_date="2026-09-14", facility="Meridian", lab_results=[_lab("Hemoglobin", "11.8", "g/dL"), _lab("MCV", "83")])
    b = _llm(lab_results=[_lab("HEMOGLOBIN", "11.8", "g/dL"), _lab("Platelets", "2.7", "lakhs")], classification_confidence="low")
    m = merge([a, b])
    assert m.document_date == "2026-09-14" and m.facility == "Meridian"
    assert [r.test_name for r in m.lab_results] == ["Hemoglobin", "MCV", "Platelets"]   # duplicate dropped, order kept


def test_merge_keeps_same_test_with_different_values():
    a = _llm(lab_results=[_lab("Glucose", "104")])
    b = _llm(lab_results=[_lab("Glucose", "5.4", "mmol/L")])
    assert len(merge([a, b]).lab_results) == 2        # different values/units are never collapsed


def test_merge_prefers_specific_document_type():
    a = _llm(document_type="other", classification_confidence="low")
    b = _llm(document_type="lab_report", classification_confidence="high")
    assert merge([a, b]).document_type == "lab_report"
