import secrets

from app.adapters.models import MockOutboundMessage
from app.platform.context import request_context
from app.platform.db.session import Database
from app.utility.notification.service import OutboundMessage


class MockMessageSender:
    """Stores every SMS and email in adp_mock_outbound_message for the simulator. Nothing is actually sent."""

    def __init__(self, db: Database):
        self.db = db

    def send(self, m: OutboundMessage) -> dict[str, str]:
        if m.channel == "SMS" and not m.dlt_template_id:
            raise RuntimeError("SMS without a DLT template id would be rejected by Indian operators")
        provider_ref = f"MOCK-{secrets.token_hex(5).upper()}"
        with self.db.tx() as s:
            s.add(
                MockOutboundMessage(
                    tenant_id=request_context.tenant_id(),
                    channel=m.channel,
                    to=m.to,
                    sender_id=m.sender_id,
                    dlt_template_id=m.dlt_template_id,
                    subject=m.subject,
                    body=m.body,
                    provider_ref=provider_ref,
                )
            )
        return {"providerRef": provider_ref}


class RealMessageSender:
    def __init__(self, db: Database):
        pass

    def send(self, m: OutboundMessage) -> dict[str, str]:
        raise RuntimeError("Real SMS/email adapter is not implemented. Set MESSAGE_ADAPTER=mock.")
