"""Subject and approval types the core uses when it hands work to generic utilities, plus IST date helpers."""

import re
from datetime import UTC, datetime, timedelta

from fastapi.responses import Response


class SUBJECT:
    order = "hsrp.order"
    dealer = "hsrp.dealer"
    station = "hsrp.station"
    oem = "hsrp.oem"
    fitment = "hsrp.fitment"
    rejection = "hsrp.rejection"
    challan = "hsrp.challan"
    job_card = "hsrp.job-card"
    wallet_group = "hsrp.wallet-group"


class APPROVAL:
    replacement_order = "replacement-order"
    plate_rejection = "plate-rejection"
    dealer_onboarding = "dealer-onboarding"


IST = timedelta(hours=5, minutes=30)


def ist_dmy(d: datetime) -> str:
    """dd-mm-yyyy in IST (VAHAN's fixation date format). `d` is naive UTC."""
    ist = d + IST
    return f"{ist.day:02d}-{ist.month:02d}-{ist.year}"


def ist_date(d: datetime | None = None) -> str:
    """YYYY-MM-DD in IST of a naive UTC datetime (default now)."""
    d = d or datetime.now(UTC).replace(tzinfo=None)
    return (d + IST).strftime("%Y-%m-%d")


def parse_date(s: str) -> datetime | None:
    """dd-mm-yyyy or yyyy-mm-dd → naive UTC midnight."""
    m = re.fullmatch(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
    if m:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def pdf_response(filename: str, pdf: bytes, status_code: int = 200) -> Response:
    """A generated PDF inline (opens in the browser's viewer, still downloadable)."""
    return Response(pdf, status_code=status_code, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{filename}"'})
