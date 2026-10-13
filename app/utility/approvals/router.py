from app.contracts.schemas import DecisionRequest
from app.platform.http.decorators import require
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/approvals", ["approvals"])


@router.get("")
@require("approvals.decide", "approvals.read")
def list_approvals(type: str | None = None, status: str | None = None, subjectId: str | None = None):  # noqa: N803
    return services().approvals.list(type, status, subjectId)


@router.post("/{id}/decision")
@require("approvals.decide")
def decide(id: str, body: DecisionRequest):
    return services().approvals.decide(id, body.decision, body.remarks)
