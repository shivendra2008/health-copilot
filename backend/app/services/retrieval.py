"""Retrieval over the authenticated user's own confirmed records (keyword scoring).
Only rows filtered by user_id are ever loaded, so other users' data cannot leak."""
import re

_STOP = set("the a an is are was were my me i of for to in on and or what which when how did do does have has "
            "with about show tell latest last recent value values result results test tests level levels my "
            "please can you any all".split())
_GENERIC = re.compile(r"\b(summar|overview|all|everything|history|latest|recent|records?)\b", re.I)


def _tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", s.lower()) if len(t) > 1 and t not in _STOP}


def build_context(db, user_id: str, question: str, max_items: int = 40) -> list[dict]:
    obs = (db.table("observations").select("id,document_id,test_name,normalized_name,category,value_text,unit,"
                                            "reference_range_text,interpretation,effective_date,is_user_corrected")
           .eq("user_id", user_id).order("effective_date", desc=True).limit(800).execute().data)
    meds = (db.table("medications").select("id,document_id,name,strength,dosage,frequency,duration,instructions,authored_date")
            .eq("user_id", user_id).order("authored_date", desc=True).limit(200).execute().data)
    conds = (db.table("conditions").select("id,document_id,description,clinical_status,recorded_date")
             .eq("user_id", user_id).order("recorded_date", desc=True).limit(200).execute().data)
    docs = (db.table("documents").select("id,file_name,doc_type,document_date,source_facility,status")
            .eq("user_id", user_id).eq("status", "confirmed").order("document_date", desc=True).limit(100).execute().data)
    names = {d["id"]: d["file_name"] for d in docs}

    candidates: list[dict] = []
    status_words = {"above_range": "above the printed reference range", "below_range": "below the printed reference range",
                    "within_range": "within the printed reference range", "unverified": "range status not verified"}
    for o in obs:
        text = (f"Lab result: {o['test_name']} = {o['value_text']}{(' ' + o['unit']) if o['unit'] else ''}"
                f"; printed reference range: {o['reference_range_text'] or 'not given'}"
                f"; {status_words[o['interpretation']]}; date {o['effective_date']}"
                + ("; value corrected by user" if o["is_user_corrected"] else ""))
        candidates.append({"kind": "observation", "id": o["id"], "document_id": o["document_id"], "date": o["effective_date"],
                           "label": o["test_name"], "detail": f"{o['value_text']} {o['unit'] or ''}".strip(),
                           "text": text, "search": f"{o['test_name']} {o['normalized_name']} {o['category'] or ''} {o['interpretation']}"})
    for m in meds:
        detail = " · ".join(x for x in (m["strength"], m["dosage"], m["frequency"], m["duration"], m["instructions"]) if x)
        candidates.append({"kind": "medication", "id": m["id"], "document_id": m["document_id"], "date": m["authored_date"],
                           "label": m["name"], "detail": detail or None,
                           "text": f"Medication documented on prescription dated {m['authored_date']}: {m['name']} {detail}",
                           "search": f"{m['name']} medication medicine prescription tablet drug"})
    for c in conds:
        candidates.append({"kind": "condition", "id": c["id"], "document_id": c["document_id"], "date": c["recorded_date"],
                           "label": c["description"], "detail": c["clinical_status"],
                           "text": f"Diagnosis as documented on {c['recorded_date']}: {c['description']}"
                                   + (f" ({c['clinical_status']})" if c["clinical_status"] else ""),
                           "search": f"{c['description']} diagnosis condition"})
    for d in docs:
        candidates.append({"kind": "document", "id": d["id"], "document_id": d["id"], "date": d["document_date"],
                           "label": d["file_name"], "detail": d["doc_type"],
                           "text": f"Document: {d['file_name']} ({d['doc_type']}) dated {d['document_date'] or 'unknown'}"
                                   + (f" from {d['source_facility']}" if d["source_facility"] else ""),
                           "search": f"{d['file_name']} {d['doc_type']} {d['source_facility'] or ''} report document"})

    q = _tokens(question)
    if "high" in question.lower() or "low" in question.lower() or "abnormal" in question.lower() or "range" in question.lower():
        q |= {"above_range", "below_range"}
    for c in candidates:
        st = _tokens(c["search"]) | ({c["search"].split()[-1]} if c["kind"] == "observation" else set())
        c["score"] = sum(2 if t in st else 0 for t in q) + sum(1 for t in q for s in st if len(t) > 3 and (t in s or s in t) and t != s)
    relevant = [c for c in candidates if c["score"] > 0]
    relevant.sort(key=lambda c: (c["score"], c["date"] or ""), reverse=True)
    if not relevant or _GENERIC.search(question):
        recent = sorted(candidates, key=lambda c: c["date"] or "", reverse=True)
        seen = {c["id"] for c in relevant}
        relevant += [c for c in recent if c["id"] not in seen]
    picked = relevant[:max_items]
    for i, c in enumerate(picked, 1):
        c["ref"] = f"R{i}"
        c["file_name"] = names.get(c["document_id"])
    return picked
