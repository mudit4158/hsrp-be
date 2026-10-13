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
OrderType = Literal["NEW", "OLD", "REPLACEMENT"]
ReplacementReason = Literal["DAMAGED", "THEFT"]
PlatePosition = Literal["FRONT", "REAR"]
PlateSet = Literal["BOTH", "FRONT", "REAR"]
VehicleClass = Literal["2W", "3W", "LMV", "HMV", "TRAILER"]
VehicleType = Literal["NON_TRANSPORT", "TRANSPORT"]
VahanMode = Literal["normal", "slow", "down", "not-found"]
TicketStatus = Literal["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]

ROLES = ("ADMIN", "OPERATIONS", "STATION_USER", "DEALER", "OEM_CLIENT", "CUSTOMER")
PLATE_STATUSES = ("AVAILABLE", "ALLOCATED", "FITTED", "SCRAPPED")
VALIDATION_STEPS = ("oem-catalogue-check", "oem-vehicle-data", "vahan-check", "state-eligibility-rules")
PAYMENT_STATUSES = ("CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED")

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
