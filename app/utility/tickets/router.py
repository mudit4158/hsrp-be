from fastapi import Depends

from app.contracts.schemas import TicketReplyRequest
from app.platform.http.decorators import require
from app.platform.http.pagination import Page, page_query
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/tickets", ["tickets"], perms=["tickets.manage"])


@router.get("")
def list_tickets(q: Page = Depends(page_query)):
    return services().tickets.list(q.get("status"), q.get("overdue") == "true", q.page, q.page_size)


@router.get("/categories")
def categories():
    return services().tickets.categories()


@router.get("/{id}")
def get(id: str):
    return services().tickets.get(id)


@router.post("/{id}/replies")
@require("tickets.manage")
def reply(id: str, body: TicketReplyRequest):
    return services().tickets.reply(id, body.message, body.status, body.is_public)
