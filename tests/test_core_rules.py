"""Ports of the pure-rule Jest specs: order-state-machine, validation-steps, misc-rules, utility-rules, billing-rules."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.contracts.enums import ORDER_STATUSES
from app.core.billing.rules import cycle_boundary, period_label, previous_boundary, resolve_bill_to, rupees
from app.core.fitment.service import parse_fitment_reply
from app.core.order_intake.state_machine import (
    CANCELLABLE,
    FINAL_STATUSES,
    TRANSITIONS,
    TransitionError,
    assert_transition,
    can_transition,
    positions_of,
    route_after_approval,
    route_after_validation,
)
from app.core.order_intake.validation_steps import (
    OemVehicleFacts,
    StateRules,
    judge_oem_vehicle,
    judge_state_rules,
    judge_vahan_reply,
)
from app.core.ports import VahanLookupReply
from app.core.pricing.service import PriceQuery, best_rule, charge_applies
from app.core.shared.subjects import ist_dmy, parse_date
from app.utility.documents.pdf import fill
from app.utility.documents.service import format_number
from app.utility.import_export.csv_tools import map_row, parse_csv, to_csv
from app.utility.notification.service import render_template
from app.utility.scheduling.service import slot_starts, weekday_of
from app.utility.tickets.service import ageing

IST = timedelta(hours=5, minutes=30)


def ist(s: str) -> datetime:
    """A wall-clock time in IST as naive UTC."""
    return datetime.fromisoformat(s) - IST


# ---------- order state machine ----------


def test_every_status_has_transitions():
    assert all(s in TRANSITIONS for s in ORDER_STATUSES)


def test_main_path():
    path = ["RECEIVED", "VALIDATED", "CONFIRMED", "ISSUED", "QC_PASSED", "STICKER_PRINTED", "DISPATCHED", "INWARDED", "FITTED", "COMPLETED"]
    assert all(can_transition(a, b) for a, b in zip(path, path[1:], strict=False))
    assert can_transition("RECEIVED", "REJECTED")


def test_routing():
    assert route_after_validation("OLD", "CUSTOMER_PORTAL") == "AWAITING_PAYMENT"
    assert can_transition("AWAITING_PAYMENT", "CONFIRMED") and not can_transition("AWAITING_PAYMENT", "REJECTED")
    assert route_after_validation("REPLACEMENT", "DEALER_APP") == route_after_validation("REPLACEMENT", "CUSTOMER_PORTAL") == "AWAITING_APPROVAL"
    assert route_after_approval("CUSTOMER_PORTAL") == "AWAITING_PAYMENT" and route_after_approval("OEM_API") == "CONFIRMED"
    for channel in ("DEALER_APP", "STAFF_WEB", "OEM_API", "OEM_FILE"):
        assert route_after_validation("NEW", channel) == "CONFIRMED"


def test_cancel_review_and_final_states():
    for s in ORDER_STATUSES:
        assert can_transition(s, "CANCELLED") == (s in CANCELLABLE)
    assert can_transition("ISSUED", "REJECTION_REVIEW") and can_transition("DISPATCHED", "REJECTION_REVIEW")
    assert all(can_transition("REJECTION_REVIEW", s) for s in ("CONFIRMED", "QC_PASSED", "INWARDED"))
    assert not can_transition("REJECTION_REVIEW", "DISPATCHED")
    assert TRANSITIONS["FITTED"] == ("COMPLETED",)
    assert all(TRANSITIONS[s] == () for s in FINAL_STATUSES)
    for a, b in (("CONFIRMED", "DISPATCHED"), ("RECEIVED", "CONFIRMED"), ("INWARDED", "COMPLETED")):
        with pytest.raises(TransitionError):
            assert_transition(a, b)
    assert positions_of("BOTH") == ["FRONT", "REAR"] and positions_of("REAR") == ["REAR"]


# ---------- validation steps ----------

CUTOFF = datetime(2019, 4, 1)
CAT = SimpleNamespace(vehicle_class="LMV")


def reply(**o):
    base = {
        "message": "Success",
        "fuel": "PETROL",
        "maker": "DEMO",
        "vch_type": "NON TRANSPORT",
        "norms": "BHARAT STAGE VI",
        "vch_catg": "LMV",
        "regn_date": "15-06-2024",
        "state_cd": "WB",
        "off_cd": "WB02",
    }
    return VahanLookupReply(**{**base, **o})


def test_vahan_step():
    assert judge_vahan_reply("NEW", "WB", reply(), CUTOFF, CAT).ok
    r = judge_vahan_reply("NEW", "WB", reply(message="Vehicle details not found"), CUTOFF, CAT)
    assert (r.ok, r.reason) == (False, "VAHAN: Vehicle details not found")
    with_plates = reply(hsrp_front_laser_code="AB1234567890")
    assert not judge_vahan_reply("NEW", "WB", with_plates, CUTOFF, CAT).ok
    assert judge_vahan_reply("REPLACEMENT", "WB", with_plates, CUTOFF, CAT).ok
    assert not judge_vahan_reply("REPLACEMENT", "WB", reply(), CUTOFF, CAT).ok
    assert not judge_vahan_reply("NEW", "WB", reply(regn_date="31-03-2019"), CUTOFF, CAT).ok
    assert judge_vahan_reply("NEW", "WB", reply(regn_date="01-04-2019"), CUTOFF, CAT).ok
    assert not judge_vahan_reply("OLD", "WB", reply(regn_date="01-04-2019"), CUTOFF, CAT).ok
    assert not judge_vahan_reply("NEW", "OD", reply(), CUTOFF, CAT).ok
    assert not judge_vahan_reply("NEW", "WB", reply(), CUTOFF, None).ok


def test_state_rules():
    assert judge_state_rules(None, StateRules()).ok
    odisha = StateRules.of({"requireMobile": True, "allowedVehicleClasses": ["2W", "LMV"], "rtoPrefixes": ["OD"]})
    assert not judge_state_rules(None, odisha, "LMV", "OD02").ok
    assert not judge_state_rules("9000000001", odisha, "HMV", "OD02").ok
    assert not judge_state_rules("9000000001", odisha, "LMV", "WB02").ok
    assert judge_state_rules("9000000001", odisha, "LMV", "OD02").ok


def test_oem_vehicle_step():
    rec = OemVehicleFacts("Kranti Autos", "Kranti Sprint", "EK12345678", "WB01", "2026-10-01")
    ok = judge_oem_vehicle("NEW", "MA1234567890ABCDE", "EK12345678", rec, None, "WB01")
    assert ok.ok and "supplied to WB01" in ok.message
    assert "not in Kranti Autos" in judge_oem_vehicle("NEW", "MA1234567890ABCDE", "EK12345678", None, "Kranti Autos", None).reason
    assert "does not match" in judge_oem_vehicle("NEW", "MA1234567890ABCDE", "EK99999999", rec, None, "WB01").reason
    assert not judge_oem_vehicle("NEW", "MA1234567890ABCDE", "EK12345678", rec, None, "WB02").ok
    no_dealer = OemVehicleFacts("Kranti Autos", "Kranti Sprint", "EK12345678", None)
    assert judge_oem_vehicle("NEW", "MA1234567890ABCDE", "EK12345678", no_dealer, None, "WB02").ok
    assert judge_oem_vehicle("OLD", "X", "Y", None, None, None).ok and judge_oem_vehicle("REPLACEMENT", "X", "Y", None, None, None).ok


# ---------- misc rules ----------


def test_fitment_reply_parsing():
    assert parse_fitment_reply("HSRP details updated successfully for WB02AB1234") == "SUCCESS"
    assert parse_fitment_reply("Vehicle WB02AB1234 not found") == parse_fitment_reply("Invalid fixation date format") == "FAILED"
    assert parse_fitment_reply("ERR#5503 <html>Gateway Timeout</html>") == parse_fitment_reply("") == "UNKNOWN"


def test_pricing():
    base = {"state_code": "WB", "vehicle_class": "LMV", "order_type": "NEW", "plate_set": "BOTH", "vehicle_type": None, "oem_code": None, "effective_from": datetime(2024, 1, 1), "effective_to": None}
    q = PriceQuery("WB", "LMV", "NEW", "BOTH", datetime(2026, 10, 1), "NON_TRANSPORT", "ZENMO")
    rules = [SimpleNamespace(**base, id="generic"), SimpleNamespace(**{**base, "oem_code": "ZENMO"}, id="oem")]
    assert best_rule(rules, q).id == "oem"
    dated = [SimpleNamespace(**{**base, "effective_to": datetime(2025, 1, 1)}, id="old"), SimpleNamespace(**{**base, "effective_from": datetime(2025, 1, 1)}, id="new")]
    assert best_rule(dated, q).id == "new"
    assert best_rule(dated, PriceQuery("WB", "LMV", "NEW", "BOTH", datetime(2024, 6, 1), "NON_TRANSPORT", "ZENMO")).id == "old"
    assert charge_applies({"greenStrip": True}, {"greenStrip": True})
    assert not charge_applies({"channel": ["CUSTOMER_PORTAL"]}, {"channel": "DEALER_APP"})


def test_dates():
    assert ist_dmy(datetime(2026, 10, 10, 20, 0)) == "11-10-2026"
    assert parse_date("05-07-2021") == parse_date("2021-07-05") == datetime(2021, 7, 5)
    assert parse_date("July 5") is None


# ---------- utility rules ----------


def test_import_mapping_and_csv():
    profile = {
        "columns": {
            "ref": {"from": "Invoice No", "required": True},
            "regnNo": {"from": "Reg", "required": True, "transform": "upper"},
            "mobile": {"from": "Mobile", "transform": "digits"},
            "date": {"from": "Date", "transform": "date-dmy"},
        }
    }
    assert map_row({"Invoice No": "INV-1", "Reg": " wb02ab1234 ", "Mobile": "+91 90000-12345", "Date": "5/7/2024"}, profile) == (
        {"ref": "INV-1", "regnNo": "WB02AB1234", "mobile": "919000012345", "date": "2024-07-05"},
        [],
    )
    assert map_row({"Invoice No": "", "Reg": "X"}, profile)[1] == ["Invoice No is required"]
    assert parse_csv(to_csv([{"a": "x,y", "b": 'say "hi"'}])) == [{"a": "x,y", "b": 'say "hi"'}]


def test_templates_slots_ageing_documents():
    assert render_template("{{otp}} is your code", {"otp": "123456"}) == "123456 is your code"
    with pytest.raises(ValueError, match="orderNo"):
        render_template("{{otp}} for {{orderNo}}", {"otp": "1"})
    assert slot_starts("10:00", "13:00", 60) == ["10:00", "11:00", "12:00"]
    assert slot_starts("10:00", "10:45", 30) == ["10:00"]
    assert weekday_of("2026-10-11") == 0
    created, due = datetime(2026, 9, 1), datetime(2026, 9, 16)
    assert ageing(created, due, "OPEN", None, datetime(2026, 9, 20)) == {"ageDays": 19, "overdue": True, "daysLeft": -4}
    assert ageing(created, due, "OPEN", None, datetime(2026, 9, 10)) == {"ageDays": 9, "overdue": False, "daysLeft": 6}
    assert ageing(created, due, "RESOLVED", datetime(2026, 9, 5), datetime(2026, 10, 1)) == {"ageDays": 4, "overdue": False, "daysLeft": None}
    assert fill("{{order.no}} / {{lines.length}} / {{missing}}", {"order": {"no": "A1"}, "lines": [1, 2]}) == "A1 / 2 / "
    assert format_number("HS{STATE}{YY}{MM}", 42, 5, datetime(2026, 10, 31, 20, 0), {"STATE": "WB"}) == "HSWB261100042"


# ---------- billing rules ----------


def test_billing_cycles():
    assert cycle_boundary("WEEKLY", ist("2026-10-14T10:00:00")) == ist("2026-10-12T00:00:00")
    assert cycle_boundary("WEEKLY", ist("2026-10-12T00:05:00")) == ist("2026-10-12T00:00:00")
    assert cycle_boundary("WEEKLY", ist("2026-10-11T23:50:00")) == ist("2026-10-05T00:00:00")
    assert previous_boundary("WEEKLY", ist("2026-10-12T00:00:00")) == ist("2026-10-05T00:00:00")
    assert cycle_boundary("MONTHLY", ist("2026-10-14T10:00:00")) == ist("2026-10-01T00:00:00")
    assert previous_boundary("MONTHLY", ist("2026-10-01T00:00:00")) == ist("2026-09-01T00:00:00")
    assert previous_boundary("MONTHLY", ist("2026-01-01T00:00:00")) == ist("2025-12-01T00:00:00")
    assert period_label(ist("2026-09-01T00:00:00"), ist("2026-10-01T00:00:00")) == "01-09-2026 to 30-09-2026"


def test_bill_to_and_rupees():
    assert resolve_bill_to("DEALER", "OEM", True) == "DEALER"
    assert resolve_bill_to(None, "DEALER", True) == "DEALER"
    assert resolve_bill_to(None, None, True) == "OEM"
    assert resolve_bill_to("DEALER", None, False) == "OEM"
    assert rupees(12_345_678) == "1,23,456.78" and rupees(99_900) == "999.00" and rupees(5) == "0.05"
