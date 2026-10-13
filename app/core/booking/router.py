from app.core.shared.subjects import ist_date
from app.platform.http.decorators import require
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/bookings", ["booking"])


@router.get("/appointments")
@require("orders.read")
def appointments(date: str | None = None, dealerId: str | None = None):  # noqa: N803
    c = services()
    dealer_id = c.scope.current().dealer_id or dealerId
    if not dealer_id:
        raise Problem.bad_request("dealerId is required")
    return c.booking.appointments(dealer_id, date or ist_date())
