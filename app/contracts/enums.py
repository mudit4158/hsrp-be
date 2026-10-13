"""Shared enums and labels. They are published in the OpenAPI document as named schemas (see CONSTANTS), from which
the web app generates its TypeScript constants and types (D48)."""

from typing import Literal

ORDER_STATUSES = (
    "RECEIVED",
    "VALIDATED",
    "AWAITING_APPROVAL",
    "AWAITING_PAYMENT",
    "CONFIRMED",
    "ISSUED",
    "QC_PASSED",
    "STICKER_PRINTED",
    "DISPATCHED",
    "INWARDED",
    "FITTED",
    "COMPLETED",
    "REJECTION_REVIEW",
    "REJECTED",
    "CANCELLED",
)
ORDER_CHANNELS = ("DEALER_APP", "STAFF_WEB", "CUSTOMER_PORTAL", "OEM_API", "OEM_FILE")
# NEW = new vehicle (dealer / OEM), OLD = registered before the cut-off (customer), REPLACEMENT = plates exist already.
ORDER_TYPES = ("NEW", "OLD", "REPLACEMENT")
REPLACEMENT_REASONS = ("DAMAGED", "THEFT")
PLATE_POSITIONS = ("FRONT", "REAR")
PLATE_SETS = ("BOTH", "FRONT", "REAR")
VEHICLE_CLASSES = ("2W", "3W", "LMV", "HMV", "TRAILER")
VEHICLE_TYPES = ("NON_TRANSPORT", "TRANSPORT")
ROLES = ("ADMIN", "OPERATIONS", "STATION_USER", "DEALER", "OEM_CLIENT", "CUSTOMER")
PLATE_STATUSES = ("AVAILABLE", "ALLOCATED", "FITTED", "SCRAPPED")
INWARD_DECISIONS = ("ACCEPT", "REJECT")
VALIDATION_STEPS = ("oem-catalogue-check", "oem-vehicle-data", "vahan-check", "state-eligibility-rules")
VAHAN_MODES = ("normal", "slow", "down", "not-found")
PAYMENT_STATUSES = ("CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED")
TICKET_STATUSES = ("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED")

OrderStatus = Literal[
    "RECEIVED",
    "VALIDATED",
    "AWAITING_APPROVAL",
    "AWAITING_PAYMENT",
    "CONFIRMED",
    "ISSUED",
    "QC_PASSED",
    "STICKER_PRINTED",
    "DISPATCHED",
    "INWARDED",
    "FITTED",
    "COMPLETED",
    "REJECTION_REVIEW",
    "REJECTED",
    "CANCELLED",
]
OrderType = Literal["NEW", "OLD", "REPLACEMENT"]
ReplacementReason = Literal["DAMAGED", "THEFT"]
PlatePosition = Literal["FRONT", "REAR"]
PlateSet = Literal["BOTH", "FRONT", "REAR"]
VehicleClass = Literal["2W", "3W", "LMV", "HMV", "TRAILER"]
VehicleType = Literal["NON_TRANSPORT", "TRANSPORT"]
VahanMode = Literal["normal", "slow", "down", "not-found"]
TicketStatus = Literal["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]

# Constant name in the web app → (OpenAPI schema name, values).
CONSTANTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "ORDER_STATUSES": ("OrderStatus", ORDER_STATUSES),
    "ORDER_CHANNELS": ("OrderChannel", ORDER_CHANNELS),
    "ORDER_TYPES": ("OrderType", ORDER_TYPES),
    "REPLACEMENT_REASONS": ("ReplacementReason", REPLACEMENT_REASONS),
    "PLATE_POSITIONS": ("PlatePosition", PLATE_POSITIONS),
    "PLATE_SETS": ("PlateSet", PLATE_SETS),
    "VEHICLE_CLASSES": ("VehicleClass", VEHICLE_CLASSES),
    "VEHICLE_TYPES": ("VehicleType", VEHICLE_TYPES),
    "ROLES": ("Role", ROLES),
    "PLATE_STATUSES": ("PlateStatus", PLATE_STATUSES),
    "INWARD_DECISIONS": ("InwardDecision", INWARD_DECISIONS),
    "VALIDATION_STEPS": ("ValidationStepCode", VALIDATION_STEPS),
    "VAHAN_MODES": ("VahanMode", VAHAN_MODES),
    "PAYMENT_STATUSES": ("PaymentStatus", PAYMENT_STATUSES),
    "TICKET_STATUSES": ("TicketStatus", TICKET_STATUSES),
}

STATUS_LABELS = {
    "RECEIVED": "Received",
    "VALIDATED": "Validated",
    "AWAITING_APPROVAL": "Awaiting approval",
    "AWAITING_PAYMENT": "Awaiting payment",
    "CONFIRMED": "Confirmed",
    "ISSUED": "Issued",
    "QC_PASSED": "QC passed",
    "STICKER_PRINTED": "Sticker printed",
    "DISPATCHED": "Dispatched",
    "INWARDED": "Inwarded",
    "FITTED": "Fitted",
    "COMPLETED": "Completed",
    "REJECTION_REVIEW": "Rejection review",
    "REJECTED": "Rejected",
    "CANCELLED": "Cancelled",
}
