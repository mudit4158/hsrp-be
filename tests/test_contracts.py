"""The shared contracts: Literal types agree with the published constants, and openapi.json is current."""

from typing import get_args

from app.contracts import enums
from app.contracts.openapi import OPENAPI_FILE, render


def test_literal_types_match_the_constants():
    pairs = [
        (enums.OrderStatus, enums.ORDER_STATUSES),
        (enums.OrderType, enums.ORDER_TYPES),
        (enums.ReplacementReason, enums.REPLACEMENT_REASONS),
        (enums.PlatePosition, enums.PLATE_POSITIONS),
        (enums.PlateSet, enums.PLATE_SETS),
        (enums.VehicleClass, enums.VEHICLE_CLASSES),
        (enums.VehicleType, enums.VEHICLE_TYPES),
        (enums.VahanMode, enums.VAHAN_MODES),
        (enums.TicketStatus, enums.TICKET_STATUSES),
    ]
    for literal, values in pairs:
        assert get_args(literal) == values
    assert set(enums.STATUS_LABELS) == set(enums.ORDER_STATUSES)


def test_openapi_file_is_current(db):
    from app.main import create_app

    assert OPENAPI_FILE.read_text(encoding="utf-8") == render(create_app()), "run .venv/Scripts/python scripts/export_openapi.py"
