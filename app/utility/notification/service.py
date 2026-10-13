"""send() renders a template and queues the message in the caller's transaction; the gateway call runs from the
outbox (subscriber `notification.dispatch`) with retries."""

import re
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.problem import NonRetryableError, Problem
from app.utility.integration_hub.call_log import CallLogService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.notification.models import NotifyMessage, NotifyTemplate


@dataclass
class OutboundMessage:
    # SMS | EMAIL
    channel: str
    to: str
    sender_id: str
    body: str
    dlt_template_id: str | None = None
    subject: str | None = None


class MessageSender(Protocol):
    """Port for SMS and email gateways. Implementations live in app/adapters."""

    def send(self, message: OutboundMessage) -> dict[str, str]: ...


_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def render_template(body: str, variables: dict[str, Any]) -> str:
    """Fills `{{name}}` placeholders. Every placeholder must have a value: wording is fixed by the template."""

    def fill(m: re.Match[str]) -> str:
        name = m.group(1)
        if name not in variables:
            raise ValueError(f'Missing template variable "{name}"')
        return _js_string(variables[name])

    return _PLACEHOLDER.sub(fill, body)


def _js_string(v: Any) -> str:
    # String(v) in JavaScript: whole floats print without ".0", booleans in lower case.
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


class NotificationService:
    def __init__(self, db: Database, bus: EventBus, calls: CallLogService, sender: MessageSender):
        self.db = db
        self.bus = bus
        self.calls = calls
        self.sender = sender
        bus.subscribe("NotificationQueued", "notification.dispatch", self._dispatch)

    def send(
        self,
        template_code: str,
        channel: str,
        recipient: str,
        variables: dict[str, Any],
        subject_type: str | None = None,
        subject_id: str | None = None,
        s: Session | None = None,
    ) -> NotifyMessage:
        tenant_id = request_context.tenant_id()
        with self.db.use(s) as session:
            tpl = session.scalar(
                select(NotifyTemplate).where(NotifyTemplate.tenant_id == tenant_id, NotifyTemplate.code == template_code, NotifyTemplate.channel == channel)
            )
            if tpl is None or not tpl.active:
                raise Problem.bad_request(f"No active {channel} template {template_code}", "template-missing")
            msg = NotifyMessage(
                tenant_id=tenant_id,
                template_code=tpl.code,
                channel=tpl.channel,
                recipient=recipient,
                sender_id=tpl.sender_id,
                dlt_template_id=tpl.dlt_template_id,
                subject=render_template(tpl.subject, variables) if tpl.subject else None,
                body=render_template(tpl.body, variables),
                variables=variables,
                subject_type=subject_type,
                subject_id=subject_id,
            )
            session.add(msg)
            session.flush()
            self.bus.publish(session, "NotificationQueued", "notification", msg.id, {"messageId": msg.id})
            return msg

    def _dispatch(self, e: DeliveredEvent) -> None:
        with self.db.tx() as s:
            msg = s.get(NotifyMessage, str(e.payload.get("messageId")))
        if msg is None:
            raise NonRetryableError("Message not found")
        if msg.status == "SENT":
            return
        out = OutboundMessage(msg.channel, msg.recipient, msg.sender_id, msg.body, msg.dlt_template_id, msg.subject)
        try:
            res = self.calls.track(
                lambda: self.sender.send(out),
                system=msg.channel,
                operation="send",
                subject_type="notification",
                subject_id=msg.id,
                request={"to": msg.recipient, "template": msg.template_code},
            )
        except Exception as err:
            with self.db.tx() as s:
                m = s.get_one(NotifyMessage, msg.id)
                m.status, m.error = "FAILED", str(err)
            raise
        with self.db.tx() as s:
            m = s.get_one(NotifyMessage, msg.id)
            m.status, m.provider_ref, m.sent_at, m.error = "SENT", res["providerRef"], utcnow(), None
