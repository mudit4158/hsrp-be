"""Request bodies. Field names are camelCase on the wire (ApiModel aliases); strings are trimmed and upper-cased where
the zod schemas did, before the constraints are checked."""

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BeforeValidator, Field, StringConstraints

from app.contracts.enums import OrderType, PlatePosition, PlateSet, ReplacementReason, TicketStatus, VahanMode
from app.platform.http.json import ApiModel


def _trim(v: Any) -> Any:
    return v.strip() if isinstance(v, str) else v


def _trim_upper(v: Any) -> Any:
    return v.strip().upper() if isinstance(v, str) else v


def _pattern(regex: str, message: str) -> AfterValidator:
    compiled = re.compile(regex)

    def check(v: str) -> str:
        if not compiled.fullmatch(v):
            raise ValueError(message)
        return v

    return AfterValidator(check)


Trimmed = Annotated[str, BeforeValidator(_trim)]
Upper = Annotated[str, BeforeValidator(_trim_upper)]
RegnNo = Annotated[str, BeforeValidator(_trim_upper), _pattern(r"[A-Z]{2}[0-9A-Z]{4,9}", "Registration number looks wrong (e.g. WB02AB1234)")]
Mobile = Annotated[str, BeforeValidator(_trim), _pattern(r"[6-9][0-9]{9}", "Ten-digit Indian mobile number")]
Identifier = Annotated[str, StringConstraints(min_length=5, max_length=30), BeforeValidator(_trim_upper)]
Email = Annotated[str, _pattern(r"[^@\s]+@[^@\s]+\.[^@\s]+", "Invalid email")]
Uuid = Annotated[str, _pattern(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", "Invalid uuid")]


# ---------- identity ----------
class LoginRequest(ApiModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    device_id: str | None = Field(None, min_length=4, max_length=100)
    device_name: str | None = Field(None, max_length=100)


class OtpRequest(ApiModel):
    purpose: Literal["ORDER_CONFIRM", "STATUS", "SUPPORT"]
    mobile: Mobile | None = None
    regn_no: RegnNo | None = None
    chassis_last5: Identifier | None = None
    ticket_no: str | None = None


class OtpVerify(ApiModel):
    otp_ref: Uuid
    code: str = Field(min_length=4, max_length=8)


# ---------- orders ----------
class VehicleIdentity(ApiModel):
    regn_no: RegnNo
    chassis_no: Identifier
    engine_no: Identifier


class CreateOrderRequest(VehicleIdentity):
    order_type: OrderType = "NEW"
    plate_set: PlateSet = "BOTH"
    replacement_reason: ReplacementReason | None = None
    evidence_file_id: Uuid | None = None
    dealer_code: str | None = None
    oem_code: str | None = None
    state_code: str | None = Field(None, min_length=2, max_length=2)
    owner_name: str | None = Field(None, max_length=100)
    mobile: Mobile | None = None
    email: Email | None = None
    remarks: str | None = Field(None, max_length=500)


class OemOrderRequest(ApiModel):
    oem_order_ref: str = Field(min_length=1, max_length=60)
    dealer_code: str = Field(min_length=1)
    regn_no: RegnNo
    chassis_no: Identifier
    engine_no: Identifier
    owner_name: str | None = Field(None, max_length=100)
    mobile: Mobile | None = None


class OemVehicleRecord(ApiModel):
    """One row of an OEM vehicle data file (vehicles built and supplied to a dealer)."""

    chassis_no: Identifier
    engine_no: Identifier
    model: Annotated[str, StringConstraints(min_length=1, max_length=80), BeforeValidator(_trim)]
    vahan_category: Annotated[str, StringConstraints(max_length=5), BeforeValidator(_trim_upper)] | None = None
    dealer_code: Annotated[str, StringConstraints(min_length=1), BeforeValidator(_trim_upper)]
    invoice_no: Annotated[str, StringConstraints(max_length=40), BeforeValidator(_trim)] | None = None
    invoice_date: Annotated[str, StringConstraints(max_length=10), BeforeValidator(_trim)] | None = None


class CancelOrderRequest(ApiModel):
    reason: str = Field(min_length=3, max_length=300)


# ---------- station ----------
class IssuanceRequest(ApiModel):
    station_id: str
    dealer_id: str
    order_ids: list[str] = Field(min_length=1, max_length=200)
    box_nos: list[Annotated[str, StringConstraints(min_length=1)]] = Field(min_length=1, max_length=20)


class BoxLockRequest(ApiModel):
    box_nos: list[str] = Field(min_length=1, max_length=20)


class QcRequest(ApiModel):
    result: Literal["PASS", "REJECT"]
    reject_positions: list[PlatePosition] | None = None
    reason: str | None = Field(None, max_length=300)


class SwitchLaserRequest(ApiModel):
    position: PlatePosition
    new_laser_code: Annotated[str, BeforeValidator(_trim_upper), _pattern(r"[A-Z]{2}\d{10}", "Invalid")]
    reason: str = Field(min_length=3, max_length=200)


class StickerPrintRequest(ApiModel):
    reprint: bool = False
    reason: str | None = Field(None, max_length=200)


class CreateChallanRequest(ApiModel):
    station_id: str
    dealer_id: str
    order_ids: list[str] = Field(min_length=1, max_length=200)


class InwardLine(ApiModel):
    line_id: str
    decision: Literal["ACCEPT", "REJECT"]
    reason: str | None = Field(None, max_length=300)


class InwardRequest(ApiModel):
    lines: list[InwardLine] = Field(min_length=1)


class DecisionRequest(ApiModel):
    decision: Literal["APPROVE", "REJECT"]
    remarks: Annotated[str, StringConstraints(min_length=3, max_length=500), BeforeValidator(_trim)]


class FitmentRequest(ApiModel):
    order_id: str
    front_laser_code: Upper | None = None
    rear_laser_code: Upper | None = None
    fitted_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None


# ---------- wallet ----------
class TopUpRequest(ApiModel):
    amount_rupees: float = Field(gt=0, le=10_000_000)
    reference: str = Field(min_length=2, max_length=60)


# ---------- tickets ----------
class TicketReplyRequest(ApiModel):
    message: str = Field(min_length=2, max_length=2000)
    status: TicketStatus | None = None
    is_public: bool = True


# ---------- simulator ----------
class VahanModeRequest(ApiModel):
    mode: VahanMode


class ConfigSetRequest(ApiModel):
    key: str = Field(min_length=2)
    scope_type: Literal["global", "state", "oem", "dealer"] = "global"
    scope_id: str = "*"
    value: Any = None
    effective_from: datetime | None = None
