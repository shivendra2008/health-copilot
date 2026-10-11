from fastapi import Query

from .db import get_db
from .errors import ApiError


class Pagination:
    def __init__(self, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
        self.limit = limit
        self.offset = offset

    @property
    def range(self) -> tuple[int, int]:
        return self.offset, self.offset + self.limit - 1


def owned_document(db, doc_id: str, user_id: str, columns: str = "*") -> dict:
    """Fetch a document only if it belongs to the user. 404 (not 403) to avoid leaking existence."""
    import uuid
    try:
        uuid.UUID(doc_id)
    except ValueError:
        raise ApiError(404, "not_found", "Document not found.")
    res = db.table("documents").select(columns).eq("id", doc_id).eq("user_id", user_id).limit(1).execute()
    if not res.data:
        raise ApiError(404, "not_found", "Document not found.")
    return res.data[0]


__all__ = ["Pagination", "owned_document", "get_db"]
