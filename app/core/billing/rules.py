"""Billing rules (D46). Pure; dates are cut in India Standard Time. Datetimes are naive UTC, as stored."""

from datetime import datetime, timedelta

from app.core.shared.subjects import IST

PAYMENT_MODES = ("PREPAID", "POSTPAID")
BILLING_CYCLES = ("WEEKLY", "MONTHLY")
BILL_TO = ("OEM", "DEALER")


def _ist_midnight(d: datetime) -> datetime:
    """Midnight IST of the IST calendar day containing `d`, as naive UTC."""
    ist = d + IST
    return datetime(ist.year, ist.month, ist.day) - IST


def cycle_boundary(cycle: str, now: datetime) -> datetime:
    """The most recent cycle boundary at or before `now`: Monday 00:00 IST (weekly) or the 1st 00:00 IST (monthly)."""
    midnight = _ist_midnight(now)
    ist = midnight + IST
    if cycle == "WEEKLY":
        return midnight - timedelta(days=ist.weekday())  # Monday = 0
    return datetime(ist.year, ist.month, 1) - IST


def previous_boundary(cycle: str, boundary: datetime) -> datetime:
    """The boundary one cycle before `boundary`."""
    if cycle == "WEEKLY":
        return boundary - timedelta(days=7)
    ist = boundary + IST
    year, month = (ist.year - 1, 12) if ist.month == 1 else (ist.year, ist.month - 1)
    return datetime(year, month, 1) - IST


def ist_day(d: datetime) -> str:
    """dd-mm-yyyy in IST."""
    return (d + IST).strftime("%d-%m-%Y")


def period_label(from_: datetime, to: datetime) -> str:
    """'01-09-2026 to 30-09-2026' (the end is the last day billed, i.e. the day before `to`)."""
    return f"{ist_day(from_)} to {ist_day(to - timedelta(milliseconds=1))}"


def resolve_bill_to(pair_setting: str | None, oem_default: str | None, has_dealer: bool) -> str:
    """Charges go to the bill-to party set for the OEM × dealer pair, else the OEM's default, else the OEM."""

    def pick(v: str | None) -> str | None:
        return v if v in BILL_TO else None

    chosen = pick(pair_setting) or pick(oem_default) or "OEM"
    return "OEM" if chosen == "DEALER" and not has_dealer else chosen


def pair_scope_id(oem_code: str, dealer_code: str) -> str:
    """Scope id of an OEM × dealer setting (scope type 'oem-dealer')."""
    return f"{oem_code}:{dealer_code}"


def rupees(paise: int) -> str:
    """Indian digit grouping with two decimals, as toLocaleString('en-IN'): 1,23,456.00."""
    sign = "-" if paise < 0 else ""
    whole, frac = divmod(abs(paise), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups) + "," + tail
    return f"{sign}{digits}.{frac:02d}"
