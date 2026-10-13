"""Template + data gives a PDF; named number sequences give unique document numbers."""

import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.documents.models import DocSequence, DocTemplate
from app.utility.documents.pdf import render_pdf

_TOKEN = re.compile(r"\{(\w+)\}")


def format_number(prefix: str, value: int, padding: int, now: datetime, vars: dict[str, str] | None = None) -> str:
    """Prefix tokens: {YYYY} {YY} {MM} {DD} (India time), plus any {name} passed in `vars`."""
    ist = now + timedelta(hours=5, minutes=30)
    tokens = {"YYYY": f"{ist.year}", "YY": f"{ist.year}"[-2:], "MM": f"{ist.month:02d}", "DD": f"{ist.day:02d}", **(vars or {})}
    return _TOKEN.sub(lambda m: tokens.get(m.group(1), ""), prefix) + str(value).zfill(padding)


class DocumentsService:
    def __init__(self, db: Database):
        self.db = db

    def next_number(self, name: str, s: Session | None = None, vars: dict[str, str] | None = None) -> str:
        """Atomically takes the next number of a sequence (inside the caller's transaction when given)."""
        with self.db.use(s) as session:
            r = session.execute(
                text(
                    "UPDATE util_doc_sequence SET next_value = next_value + 1, updated_at = now() "
                    "WHERE tenant_id = :tenant AND name = :name RETURNING prefix, next_value - 1 AS value, padding"
                ),
                {"tenant": request_context.tenant_id(), "name": name},
            ).first()
        if r is None:
            raise Problem.bad_request(f"Number sequence {name} is not configured", "sequence-missing")
        return format_number(r.prefix, int(r.value), r.padding, utcnow(), vars)

    def ensure_sequence(self, name: str, prefix: str, padding: int = 6, s: Session | None = None) -> DocSequence:
        now = utcnow()
        tenant_id = request_context.tenant_id()
        with self.db.use(s) as session:
            session.execute(
                insert(DocSequence)
                .values(id=new_id(), tenant_id=tenant_id, name=name, prefix=prefix, padding=padding, next_value=1, created_at=now, updated_at=now)
                .on_conflict_do_nothing(index_elements=["tenant_id", "name"])
            )
            return session.scalars(select(DocSequence).where(DocSequence.tenant_id == tenant_id, DocSequence.name == name)).one()

    def render(self, template_code: str, data: dict[str, Any]) -> bytes:
        with self.db.tx() as s:
            tpl = s.scalar(select(DocTemplate).where(DocTemplate.tenant_id == request_context.tenant_id(), DocTemplate.code == template_code))
        if tpl is None:
            raise Problem.bad_request(f"Print template {template_code} is not configured", "template-missing")
        return render_pdf(tpl.layout, data)

    def upsert_template(self, code: str, name: str, layout: dict[str, Any], s: Session | None = None) -> DocTemplate:
        now = utcnow()
        stmt = (
            insert(DocTemplate)
            .values(id=new_id(), tenant_id=request_context.tenant_id(), code=code, name=name, layout=layout, version=1, created_at=now, updated_at=now)
            .on_conflict_do_update(
                index_elements=["tenant_id", "code"],
                set_={"name": name, "layout": layout, "version": DocTemplate.__table__.c.version + 1, "updated_at": now},
            )
            .returning(DocTemplate)
        )
        with self.db.use(s) as session:
            return session.scalars(stmt).one()

    def list_templates(self) -> list[DocTemplate]:
        with self.db.tx() as s:
            return list(s.scalars(select(DocTemplate).where(DocTemplate.tenant_id == request_context.tenant_id()).order_by(DocTemplate.code)))
