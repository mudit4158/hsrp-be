"""The order lifecycle (handover section 7). Every status change goes through `assert_transition`.
DISPATCHED → STICKER_PRINTED happens only when a challan is cancelled (D21)."""

TRANSITIONS: dict[str, tuple[str, ...]] = {
    "RECEIVED": ("VALIDATED", "REJECTED", "CANCELLED"),
    "VALIDATED": ("AWAITING_APPROVAL", "AWAITING_PAYMENT", "CONFIRMED", "REJECTED", "CANCELLED"),
    "AWAITING_APPROVAL": ("AWAITING_PAYMENT", "CONFIRMED", "REJECTED", "CANCELLED"),
    "AWAITING_PAYMENT": ("CONFIRMED", "CANCELLED"),
    "CONFIRMED": ("ISSUED", "CANCELLED"),
    "ISSUED": ("QC_PASSED", "REJECTION_REVIEW"),
    "QC_PASSED": ("STICKER_PRINTED",),
    "STICKER_PRINTED": ("DISPATCHED",),
    "DISPATCHED": ("INWARDED", "REJECTION_REVIEW", "STICKER_PRINTED"),
    "INWARDED": ("FITTED",),
    "FITTED": ("COMPLETED",),
    "REJECTION_REVIEW": ("CONFIRMED", "QC_PASSED", "INWARDED"),
    "COMPLETED": (),
    "REJECTED": (),
    "CANCELLED": (),
}

FINAL_STATUSES = ("COMPLETED", "REJECTED", "CANCELLED")

# "Any before ISSUED → CANCELLED".
CANCELLABLE = ("RECEIVED", "VALIDATED", "AWAITING_APPROVAL", "AWAITING_PAYMENT", "CONFIRMED")


class TransitionError(Exception):
    def __init__(self, from_: str, to: str):
        super().__init__(f"Order cannot move from {from_} to {to}")
        self.from_ = from_
        self.to = to


def can_transition(from_: str, to: str) -> bool:
    return to in TRANSITIONS.get(from_, ())


def assert_transition(from_: str, to: str) -> None:
    if not can_transition(from_, to):
        raise TransitionError(from_, to)


def route_after_validation(order_type: str, channel: str) -> str:
    """Where a customer/dealer/OEM order goes once validated."""
    if order_type == "REPLACEMENT":
        return "AWAITING_APPROVAL"
    if channel == "CUSTOMER_PORTAL":
        return "AWAITING_PAYMENT"
    return "CONFIRMED"


def route_after_approval(channel: str) -> str:
    """After operations approve a replacement: customers still pay; dealer and OEM orders are confirmed."""
    return "AWAITING_PAYMENT" if channel == "CUSTOMER_PORTAL" else "CONFIRMED"


def positions_of(plate_set: str) -> list[str]:
    """Positions in a plate set."""
    if plate_set == "FRONT":
        return ["FRONT"]
    if plate_set == "REAR":
        return ["REAR"]
    return ["FRONT", "REAR"]
