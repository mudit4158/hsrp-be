from pydantic import Field

from app.contracts.schemas import TopUpRequest
from app.platform.http.decorators import idempotent, require
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.wallet.service import to_paise

router = api_router("/wallets", ["wallets"], perms=["wallet.read"])


class CreditLimitBody(ApiModel):
    credit_limit_rupees: float = Field(ge=0, le=100_000_000)


@router.get("")
def list_wallets():
    return services().wallets.list()


@router.get("/{id}")
def summary(id: str):
    return services().wallets.summary(id)


@router.get("/{id}/statement")
def statement(id: str, page: str = "1"):
    try:
        n = int(float(page)) or 1
    except ValueError:
        n = 1
    return services().wallets.statement(id, n)


@router.get("/{id}/holds")
def holds(id: str, status: str | None = None):
    return services().wallets.holds_for(id, status)


@router.post("/{id}/top-ups")
@require("wallet.manage")
@idempotent
def top_up(id: str, body: TopUpRequest):
    return services().wallets.top_up(id, to_paise(body.amount_rupees), body.reference)


@router.patch("/{id}/credit-limit")
@require("wallet.manage")
def credit_limit(id: str, body: CreditLimitBody):
    return services().wallets.set_credit_limit(id, to_paise(body.credit_limit_rupees))
