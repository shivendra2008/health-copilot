import pymupdf
import pytest

from app.errors import ApiError
from app.services.files import safe_filename, validate_upload


def _pdf(pages=1, text="Hemoglobin 11.2 g/dL"):
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page().insert_text((50, 80), text)
    return doc.tobytes()


def _png():
    doc = pymupdf.open()
    p = doc.new_page(width=100, height=100)
    return p.get_pixmap().tobytes("png")


def test_valid_pdf_and_png():
    v = validate_upload("report.pdf", "application/pdf", _pdf(3))
    assert v.mime_type == "application/pdf" and v.page_count == 3 and len(v.sha256) == 64
    assert validate_upload("scan.PNG", "image/png", _png()).mime_type == "image/png"


@pytest.mark.parametrize("name,data,code", [
    ("a.pdf", b"", "empty_file"),
    ("a.exe", b"MZ\x90\x00", "unsupported_type"),
    ("a.pdf", b"\x89PNG\r\n\x1a\n0000", "content_mismatch"),      # extension lies
    ("a.png", b"%PDF-1.7 garbage", "content_mismatch"),
    ("a.pdf", b"%PDF-1.7 this is not really a pdf", "malformed_file"),
])
def test_rejects_bad_files(name, data, code):
    with pytest.raises(ApiError) as e:
        validate_upload(name, None, data)
    assert e.value.code == code


def test_declared_mime_mismatch():
    with pytest.raises(ApiError) as e:
        validate_upload("a.pdf", "image/png", _pdf())
    assert e.value.code == "content_mismatch"


def test_too_many_pages():
    with pytest.raises(ApiError) as e:
        validate_upload("a.pdf", None, _pdf(31))
    assert e.value.code == "too_many_pages"


def test_safe_filename():
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("my report<script>.pdf") == "my report_script_.pdf"
    assert safe_filename("") == "document"
