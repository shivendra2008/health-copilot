import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import get_settings
from .errors import install_error_handlers
from .routers import assistant, auth_routes, documents, medication_safety, profile, records
from .services.ocr import ocr_available

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
for noisy in ("httpx", "httpcore", "hpack"):
    logging.getLogger(noisy).setLevel(logging.WARNING)  # avoid logging URLs/headers

settings = get_settings()
app = FastAPI(title="Health Copilot API", version="1.0.0",
              docs_url="/docs" if settings.app_env != "production" else None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
                   allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type"], max_age=86400)  # cache the CORS preflight for a day
app.add_middleware(GZipMiddleware, minimum_size=1000)
install_error_handlers(app)


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.get("/api/v1/health", tags=["system"])
def health():
    s = get_settings()
    return {"status": "ok", "supabase_configured": s.supabase_configured, "ai_configured": s.groq_configured,
            "ai_model": s.groq_model, "ocr_available": ocr_available()}


for r in (auth_routes.router, documents.router, records.router, profile.router, assistant.router, medication_safety.router):
    app.include_router(r)
