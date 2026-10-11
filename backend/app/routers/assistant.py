import re

from fastapi import APIRouter, Depends

from ..audit import audit
from ..auth import CurrentUser, get_current_user
from ..config import get_settings
from ..deps import Pagination, get_db
from ..errors import ApiError
from ..ratelimit import check_rate_limit
from ..schemas.api import ChatRequest, ChatResponse, Citation
from ..services.groq_client import LLMError, chat_json
from ..services.prompts import ASSISTANT_SCHEMA, ASSISTANT_SYSTEM, LANG_NAMES
from ..services.retrieval import build_context

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])

NO_DATA = {
    "en": "You don't have any confirmed records yet. Upload a report and confirm its extracted values, then ask me about it.",
    "hi": "अभी आपके कोई पुष्ट रिकॉर्ड नहीं हैं। कोई रिपोर्ट अपलोड करें और निकाले गए मानों की पुष्टि करें, फिर मुझसे पूछें।",
    "mr": "अद्याप तुमच्याकडे कोणतेही पुष्टी केलेले रेकॉर्ड नाहीत. एखादा अहवाल अपलोड करा आणि काढलेल्या मूल्यांची पुष्टी करा, मग मला विचारा.",
}


def _conversation(db, user_id: str, conv_id: str | None, first_message: str) -> dict:
    if conv_id:
        res = db.table("assistant_conversations").select("*").eq("id", conv_id).eq("user_id", user_id).limit(1).execute().data
        if not res:
            raise ApiError(404, "not_found", "Conversation not found.")
        return res[0]
    title = re.sub(r"\s+", " ", first_message).strip()[:60]
    return db.table("assistant_conversations").insert({"user_id": user_id, "title": title}).execute().data[0]


@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    check_rate_limit(user.id, "chat", get_settings().rate_limit_chat)
    db = get_db()
    conv = _conversation(db, user.id, body.conversation_id, body.message)
    history = (db.table("assistant_messages").select("role,content").eq("conversation_id", conv["id"])
               .eq("user_id", user.id).order("created_at", desc=True).limit(6).execute().data)[::-1]
    db.table("assistant_messages").insert({"conversation_id": conv["id"], "user_id": user.id,
                                           "role": "user", "content": body.message}).execute()

    context = build_context(db, user.id, body.message)
    if not context:
        answer, cites, insufficient = NO_DATA[body.language], [], True
    else:
        ctx = "\n".join(f"[{c['ref']}] {c['text']}" + (f" (source file: {c['file_name']})" if c.get("file_name") else "")
                        for c in context)
        hist = "\n".join(f"{m['role'].upper()}: {m['content'][:500]}" for m in history)
        prompt = (f"CONTEXT ITEMS (the user's own confirmed records):\n{ctx}\n\n"
                  + (f"RECENT CONVERSATION:\n{hist}\n\n" if hist else "")
                  + f"QUESTION:\n{body.message}")
        try:
            raw, _ = chat_json(ASSISTANT_SYSTEM.format(language=LANG_NAMES[body.language]), prompt,
                               "grounded_answer", ASSISTANT_SCHEMA, temperature=0.2, max_tokens=1500, max_wait=20.0)
        except LLMError as e:
            raise ApiError(429 if e.code == "ai_rate_limited" else 503, e.code, e.message)
        by_ref = {c["ref"]: c for c in context}
        refs = [r.strip("[] ") for r in raw.get("citations", [])]
        refs += re.findall(r"\[(R\d+)\]", raw.get("answer", ""))
        cites, seen = [], set()
        for r in refs:  # drop any citation that does not map to a real retrieved record
            if r in by_ref and r not in seen:
                seen.add(r)
                c = by_ref[r]
                cites.append({"ref": r, "kind": c["kind"], "document_id": c["document_id"], "label": c["label"],
                              "detail": c.get("detail"), "date": c.get("date")})
        answer = raw.get("answer", "").strip() or NO_DATA[body.language]
        insufficient = bool(raw.get("insufficient_information")) or not cites

    msg = db.table("assistant_messages").insert({
        "conversation_id": conv["id"], "user_id": user.id, "role": "assistant", "content": answer,
        "citations": cites, "insufficient_information": insufficient,
    }).execute().data[0]
    db.table("assistant_conversations").update({"title": conv["title"]}).eq("id", conv["id"]).execute()
    audit(db, user.id, "assistant.asked", "conversation", conv["id"], {"context_items": len(context), "citations": len(cites)})
    return ChatResponse(conversation_id=conv["id"], message_id=msg["id"], answer=answer,
                        citations=[Citation(**c) for c in cites], insufficient_information=insufficient)


@router.get("/conversations")
def list_conversations(p: Pagination = Depends(), user: CurrentUser = Depends(get_current_user)):
    res = (get_db().table("assistant_conversations").select("id,title,created_at,updated_at", count="exact")
           .eq("user_id", user.id).order("updated_at", desc=True).range(*p.range).execute())
    return {"items": res.data, "total": res.count or 0, "limit": p.limit, "offset": p.offset}


@router.get("/conversations/{conv_id}/messages")
def messages(conv_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    _conversation(db, user.id, conv_id, "")
    return {"items": db.table("assistant_messages").select("id,role,content,citations,insufficient_information,created_at")
            .eq("conversation_id", conv_id).eq("user_id", user.id).order("created_at").execute().data}


@router.delete("/conversations/{conv_id}", status_code=204)
def delete_conversation(conv_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    _conversation(db, user.id, conv_id, "")
    db.table("assistant_conversations").delete().eq("id", conv_id).eq("user_id", user.id).execute()
    from fastapi import Response
    return Response(status_code=204)
