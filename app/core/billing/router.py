from typing import Annotated, Literal

from pydantic import StringConstraints

from app.contracts.schemas import Email
from app.core.shared.subjects import pdf_response
from app.platform.http.decorators import require
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/billing", ["billing"])

BillTo = Literal["OEM", "DEALER"]


class OemBillingBody(ApiModel):
    payment_mode: Literal["PREPAID", "POSTPAID"] | None = None
    cycle: Literal["WEEKLY", "MONTHLY"] | None = None
    bill_to_default: BillTo | None = None
    contact_email: Email | Literal[""] | None = None


class PairBody(ApiModel):
    bill_to: BillTo


class RunBody(ApiModel):
    oem_code: Annotated[str, StringConstraints(min_length=1)]


@router.get("/setup")
@require("billing.read")
def setup():
    return services().billing.setup()


@router.put("/oems/{oemCode}")
@require("billing.manage")
def configure_oem(oemCode: str, body: OemBillingBody):  # noqa: N803
    return services().billing.configure_oem(oemCode, body.payment_mode, body.cycle, body.bill_to_default, body.contact_email)


@router.put("/oems/{oemCode}/dealers/{dealerCode}")
@require("billing.manage")
def configure_pair(oemCode: str, dealerCode: str, body: PairBody):  # noqa: N803
    return services().billing.configure_pair(oemCode, dealerCode, body.bill_to)


@router.get("/charges")
@require("billing.read")
def charges(status: str | None = None, oemCode: str | None = None):  # noqa: N803
    return services().billing.charges(status, oemCode)


@router.get("/bills")
@require("billing.read")
def bills(oemCode: str | None = None, status: str | None = None):  # noqa: N803
    return services().billing.bills(oemCode, status)


@router.get("/bills/{id}")
@require("billing.read")
def bill(id: str):
    return services().billing.bill(id)


@router.get("/bills/{id}/pdf")
@require("billing.read")
def pdf(id: str):
    return pdf_response(*services().billing.pdf(id))


@router.post("/run", status_code=200)
@require("billing.manage")
def run(body: RunBody):
    """Closes the current period now for one postpaid OEM ('Run billing now')."""
    return services().billing.run(body.oem_code, "manual")


@router.post("/bills/{id}/send", status_code=200)
@require("billing.manage")
def send(id: str):
    return services().billing.send(id)


@router.post("/bills/{id}/paid", status_code=200)
@require("billing.manage")
def paid(id: str):
    return services().billing.mark_paid(id)
