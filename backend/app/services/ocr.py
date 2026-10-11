"""PaddleOCR wrapper. Lazily loaded singleton so the API starts fast and keeps
working (with an explicit 'OCR unavailable' state) if Paddle cannot be loaded."""
import logging
import os
import threading
from dataclasses import dataclass

from ..config import get_settings

log = logging.getLogger("healthcopilot.ocr")
_lock = threading.Lock()
_engine = None
_load_error: str | None = None


class OcrUnavailable(Exception):
    pass


@dataclass
class OcrResult:
    text: str
    confidence: float | None  # mean recognition score 0..1
    lines: int


def _load():
    global _engine, _load_error
    if _engine is not None or _load_error is not None:
        return
    with _lock:
        if _engine is not None or _load_error is not None:
            return
        try:
            os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
            from paddleocr import PaddleOCR  # heavy import

            _engine = PaddleOCR(
                lang=get_settings().ocr_lang,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_recognition_model_name="en_PP-OCRv5_mobile_rec"
                if get_settings().ocr_lang == "en" else None,
                cpu_threads=get_settings().ocr_cpu_threads,
            )
            log.info("PaddleOCR loaded")
        except Exception as exc:  # noqa: BLE001
            _load_error = f"{type(exc).__name__}"
            log.error("PaddleOCR failed to load: %s", _load_error)


def ocr_available() -> bool:
    if not get_settings().ocr_enabled:
        return False
    try:
        import importlib.util
        return importlib.util.find_spec("paddleocr") is not None and _load_error is None
    except Exception:
        return False


def run_ocr(image_bytes: bytes) -> OcrResult:
    """OCR a PNG/JPEG image. Lines are returned in reading order (top→bottom, left→right)."""
    if not get_settings().ocr_enabled:
        raise OcrUnavailable("OCR is disabled (OCR_ENABLED=false).")
    _load()
    if _engine is None:
        raise OcrUnavailable("OCR engine could not be loaded on this server.")

    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Image could not be decoded")
    with _lock:  # Paddle predictors are not thread-safe
        results = _engine.predict(img)

    items: list[tuple[float, float, str, float]] = []
    for res in results:
        data = res.json.get("res", res) if hasattr(res, "json") else res
        texts = data.get("rec_texts", []) or []
        scores = data.get("rec_scores", []) or []
        boxes = data.get("rec_boxes", []) or data.get("rec_polys", []) or []
        for i, t in enumerate(texts):
            score = float(scores[i]) if i < len(scores) else 0.0
            y, x = 0.0, 0.0
            if i < len(boxes):
                b = np.array(boxes[i]).reshape(-1)
                if b.size >= 4:
                    x, y = float(b[0]), float(b[1])
            items.append((y, x, str(t), score))

    return _assemble(items)


def _assemble(items: list[tuple[float, float, str, float]]) -> OcrResult:
    """Group boxes into text lines by vertical position so table rows stay together."""
    if not items:
        return OcrResult("", None, 0)
    items.sort(key=lambda r: (r[0], r[1]))
    lines: list[list[tuple[float, float, str, float]]] = []
    tolerance = 12.0
    for it in items:
        if lines and abs(lines[-1][0][0] - it[0]) <= tolerance:
            lines[-1].append(it)
        else:
            lines.append([it])
    text_lines = ["   ".join(t for _, _, t, _ in sorted(line, key=lambda r: r[1])) for line in lines]
    conf = sum(s for *_, s in items) / len(items)
    return OcrResult("\n".join(text_lines), round(conf, 4), len(text_lines))
