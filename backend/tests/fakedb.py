"""Tiny in-memory stand-in for the Supabase client (select/insert/update/delete with eq/neq/is_/order/limit/range)."""
import itertools
import uuid

_ids = itertools.count(1)


class Result:
    def __init__(self, data, count=None):
        self.data, self.count = data, count


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op, self.payload, self.filters, self._range, self._order = "select", None, [], None, None

    def select(self, *a, **k): self.op = "select"; return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def update(self, d): self.op, self.payload = "update", d; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, c, v): self.filters.append(lambda r: r.get(c) == v); return self
    def neq(self, c, v): self.filters.append(lambda r: r.get(c) != v); return self
    def is_(self, c, v): self.filters.append(lambda r: r.get(c) is None); return self
    def in_(self, c, vs): self.filters.append(lambda r: r.get(c) in vs); return self
    def order(self, c, desc=False): self._order = (c, desc); return self
    def limit(self, n): return self
    def range(self, a, b): self._range = (a, b); return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for it in items:
                r = {"id": str(uuid.UUID(int=next(_ids))), "created_at": "2026-10-24T10:00:00+00:00", **it}
                r.setdefault("uncertain_fields", [])
                rows.append(r)
                out.append(dict(r))
            return Result(out)
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in match:
                r.update(self.payload)
            return Result([dict(r) for r in match])
        if self.op == "delete":
            for r in match:
                rows.remove(r)
            return Result([])
        if self._order:
            match.sort(key=lambda r: str(r.get(self._order[0])), reverse=self._order[1])
        total = len(match)
        if self._range:
            match = match[self._range[0]:self._range[1] + 1]
        return Result([dict(r) for r in match], total)


class FakeDB:
    def __init__(self, **tables):
        self.tables = {k: list(v) for k, v in tables.items()}

    def table(self, name): return Query(self, name)
