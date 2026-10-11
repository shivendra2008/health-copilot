"""Audit logging. Only metadata — never raw medical text, file contents or secrets."""
import logging

log = logging.getLogger("healthcopilot.audit")


def audit(db, user_id: str | None, action: str, entity_type: str | None = None,
          entity_id: str | None = None, metadata: dict | None = None) -> None:
    try:
        db.table("audit_logs").insert({
            "user_id": user_id, "action": action, "entity_type": entity_type,
            "entity_id": entity_id, "metadata": metadata or {},
        }).execute()
    except Exception:  # auditing must never break the request
        log.warning("audit write failed for action=%s", action)
