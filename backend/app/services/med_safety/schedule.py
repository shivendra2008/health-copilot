"""Medicine calendar: turns the frequency, duration and start date WRITTEN on a prescription into dose slots.

Deterministic and conservative. Nothing is invented:
  * the slot pattern comes only from what is written (1-0-1, BD, TDS, HS, ...); "as needed", "every N hours" and unclear
    text get no fixed times and no reminders;
  * a course whose end is not written is shown with an open end, and reminders for it are off until the person turns them on;
  * a medicine that matches a recorded allergy never gets a reminder.
The phone expands these courses into days and turns slots into clock times (the person can change the times).
"""
from datetime import date

from .kidney import _item
from .parser import _FREQ_WORD, _SCHEDULE, _TIMING, decode_frequency, decode_timing
from .dose import doses_per_day, units_per_dose

SLOT_TIMES = {"morning": "08:00", "afternoon": "14:00", "evening": "18:00", "night": "21:00"}
_BY_COUNT = {1: ["morning"], 2: ["morning", "night"], 3: ["morning", "afternoon", "night"], 4: ["morning", "afternoon", "evening", "night"]}
_WORD_SLOTS = {"once_daily": 1, "twice_daily": 2, "three_times_daily": 3, "four_times_daily": 4}
HISTORY_DAYS = 60
LIMITATIONS = ["schedule_from_prescription", "schedule_default_times", "schedule_not_medical_advice"]


def _code(frequency: str | None, instructions: str | None) -> str | None:
    for text in (frequency or "", instructions or ""):
        m = _SCHEDULE.search(text) or _FREQ_WORD.search(text)
        if m:
            return m.group(0)
    return None


def plan(frequency: str | None, dosage: str | None, instructions: str | None = None) -> dict:
    """{slots: [{slot, units}], as_needed, once, interval_hours, food, needs_details}"""
    out = {"slots": [], "as_needed": False, "once": False, "interval_hours": None, "food": None, "needs_details": []}
    text = f"{frequency or ''} {instructions or ''}"
    t = _TIMING.search(text)
    if t:
        out["food"] = (decode_timing(t.group(0)) or {}).get("meaning")
    info = decode_frequency(_code(frequency, instructions))
    meaning = info["meaning"] if info else None
    if meaning == "schedule":
        nums = info["slots"]
        names = ["morning", "afternoon", "night"] if len(nums) == 3 else ["morning", "afternoon", "evening", "night"]
        out["slots"] = [{"slot": n, "units": u} for n, u in zip(names, nums) if u > 0]
    elif meaning in _WORD_SLOTS or meaning == "at_bedtime":
        names = ["night"] if meaning == "at_bedtime" else _BY_COUNT[_WORD_SLOTS[meaning]]
        out["slots"] = [{"slot": n, "units": units_per_dose(dosage)} for n in names]
    elif meaning == "as_needed":
        out["as_needed"] = True
    elif meaning == "single_dose_now":
        out["once"] = True
    elif meaning == "every_n_hours":
        out["interval_hours"] = info["hours"]
    else:
        n = doses_per_day(frequency)  # "3 times a day" and similar
        if n in _BY_COUNT:
            out["slots"] = [{"slot": s, "units": units_per_dose(dosage)} for s in _BY_COUNT[n]]
    if not (out["slots"] or out["as_needed"] or out["once"] or out["interval_hours"]):
        out["needs_details"].append("frequency")
    return out


def build_schedule(rows: list[dict], today: date | None = None, allergy_alert_ids: set[str] | None = None) -> dict:
    today = today or date.today()
    blocked = allergy_alert_ids or set()
    courses, undated = [], []
    for r in rows:
        it = _item(r)
        p = plan(r.get("frequency"), r.get("dosage"), r.get("instructions"))
        start, end = it["_start"], it["_end"]
        if start is not None and end is not None and (today - end).days > HISTORY_DAYS:
            continue  # finished long ago
        if start is not None and end is None and (today - start).days > 365 and not it["ongoing"]:
            continue  # no end written and started over a year ago: not assumed to be still running
        details = list(p["needs_details"]) + (["start_date"] if start is None else [])
        if it["id"] in blocked:
            reminders = "blocked_allergy"
        elif not p["slots"] or start is None:
            reminders = "unsupported"
        else:
            reminders = "default_on" if (end is not None or it["ongoing"]) else "default_off"
        c = {"id": it["id"], "document_id": it["document_id"], "name": it["name"], "strength": it["strength"], "dosage": it["dosage"],
             "frequency": it["frequency"], "duration": it["duration"], "start": it["start"], "end": it["end"], "end_known": it["end_known"],
             "ongoing": it["ongoing"], "slots": p["slots"], "as_needed": p["as_needed"], "once": p["once"],
             "interval_hours": p["interval_hours"], "food": p["food"], "needs_details": details, "reminders": reminders,
             "clinician": it["clinician"], "file_name": it["file_name"], "allergy": it["id"] in blocked}
        (undated if start is None else courses).append(c)
    courses.sort(key=lambda c: (c["start"], c["name"]))
    return {"today": today.isoformat(), "courses": courses, "undated": undated, "slot_times": SLOT_TIMES, "limitations": LIMITATIONS}
