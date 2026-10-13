"""Validation rules for an order. Pure; the I/O lives in the order flow service."""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.core.ports import VahanLookupReply
from app.core.shared.subjects import parse_date


@dataclass
class StateRules:
    # Send an SMS at every main status change (Odisha demo pack).
    sms_status_updates: bool = False
    require_mobile: bool = False
    allowed_vehicle_classes: list[str] | None = None
    # Registering office code must start with one of these (e.g. "OD").
    rto_prefixes: list[str] | None = None
    published_prices: bool = False

    @staticmethod
    def of(raw: dict[str, Any] | None) -> "StateRules":
        raw = raw or {}
        return StateRules(
            bool(raw.get("smsStatusUpdates")),
            bool(raw.get("requireMobile")),
            raw.get("allowedVehicleClasses"),
            raw.get("rtoPrefixes"),
            bool(raw.get("publishedPrices")),
        )


@dataclass
class StepResult:
    ok: bool
    message: str | None = None
    reason: str | None = None
    data: Any = field(default=None)


def judge_vahan_reply(order_type: str, state_code: str, reply: VahanLookupReply, cutoff: datetime, category: Any) -> StepResult:
    """Interprets a VAHAN lookup reply against the order."""
    if not re.fullmatch(r"success", reply.message.strip(), re.I):
        return StepResult(False, reason=f"VAHAN: {reply.message}")
    if reply.state_cd and reply.state_cd != state_code:
        return StepResult(False, reason=f"Vehicle is registered in {reply.state_cd}, not {state_code}")
    has_plates = bool(reply.hsrp_front_laser_code or reply.hsrp_rear_laser_code)
    if has_plates and order_type != "REPLACEMENT":
        codes = ", ".join(c for c in (reply.hsrp_front_laser_code, reply.hsrp_rear_laser_code) if c)
        return StepResult(False, reason=f"HSRP already issued (laser codes {codes}); only a replacement order is valid")
    if not has_plates and order_type == "REPLACEMENT":
        return StepResult(False, reason="VAHAN shows no HSRP for this vehicle; place a new order instead of a replacement")
    regn = parse_date(reply.regn_date)
    if regn is None:
        return StepResult(False, reason=f'Unreadable registration date "{reply.regn_date}"')
    if order_type == "NEW" and regn < cutoff:
        return StepResult(False, reason=f"Registered {reply.regn_date}, before the new-vehicle cut-off {cutoff.strftime('%Y-%m-%d')}; this is an old-vehicle order")
    if order_type == "OLD" and regn >= cutoff:
        return StepResult(False, reason=f"Registered {reply.regn_date}, after the cut-off; new vehicles get HSRP through their dealer")
    if not category:
        return StepResult(False, reason=f"Unknown VAHAN vehicle category {reply.vch_catg}")
    return StepResult(True, f"{reply.maker} · {reply.vch_catg} · {reply.norms}")


def judge_state_rules(mobile: str | None, rules: StateRules, vehicle_class: str | None = None, off_cd: str | None = None) -> StepResult:
    """State eligibility rule pack."""
    if rules.require_mobile and not mobile:
        return StepResult(False, reason="This state requires the owner mobile number")
    if rules.allowed_vehicle_classes and vehicle_class and vehicle_class not in rules.allowed_vehicle_classes:
        return StepResult(False, reason=f"Vehicle class {vehicle_class} is not eligible in this state")
    if rules.rto_prefixes and off_cd and not any(off_cd.startswith(p) for p in rules.rto_prefixes):
        return StepResult(False, reason=f"Registering office {off_cd} is outside this state's offices")
    return StepResult(True, "Eligible")


@dataclass
class OemVehicleFacts:
    oem_name: str
    model: str
    engine_no: str
    dealer_code: str | None
    invoice_date: str | None = None


def judge_oem_vehicle(order_type: str, chassis_no: str, engine_no: str, record: OemVehicleFacts | None, oem_name: str | None, order_dealer_code: str | None) -> StepResult:
    """A new-vehicle order against the OEM vehicle data. `record` is the OEM's row for the order's chassis (None when the
    chassis is not in the data); `order_dealer_code` is the ordering dealer."""
    if order_type != "NEW":
        return StepResult(True, "Not a new-vehicle order; OEM data not needed")
    if record is None:
        return StepResult(False, reason=f"Chassis {chassis_no} is not in {oem_name or 'the OEM'}'s vehicle data")
    if record.engine_no.upper() != engine_no.upper():
        return StepResult(
            False,
            reason=f"Engine {engine_no} does not match {record.oem_name}'s record for chassis {chassis_no} (engine ending {record.engine_no[-5:]})",
        )
    if record.dealer_code and order_dealer_code and record.dealer_code != order_dealer_code:
        return StepResult(False, reason=f"{record.oem_name} supplied chassis {chassis_no} to dealer {record.dealer_code}, not {order_dealer_code}")
    supplied = f" · supplied to {record.dealer_code}{f' on {record.invoice_date}' if record.invoice_date else ''}" if record.dealer_code else ""
    return StepResult(True, f"{record.oem_name} · {record.model}{supplied}")
