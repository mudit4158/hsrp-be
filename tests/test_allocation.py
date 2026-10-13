"""Port of src/core/inventory/allocation.spec.ts: box locks, one active allocation per laser code, history on switch
and scrap."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.inventory.models import Plate, PlateAllocation, PlateBox
from app.core.inventory.service import InventoryService
from app.platform.context import Actor, RequestContext, request_context
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from tests.conftest import TEST_TENANT, as_system

STATION = "stn-1"


class _Imports:
    def register_target(self, *_):
        pass


@pytest.fixture
def inv(clean):
    with clean.tx() as s:
        for box_no, prefix in (("BOX-A", "AA"), ("BOX-B", "BB")):
            box = PlateBox(tenant_id=TEST_TENANT, box_no=box_no, station_id=STATION, product_code="500X120", plate_count=2)
            s.add(box)
            s.flush()
            s.add_all(Plate(tenant_id=TEST_TENANT, laser_code=f"{prefix}000000000{i}", box_id=box.id, station_id=STATION, product_code="500X120") for i in (1, 2))
        s.add(PlateBox(tenant_id=TEST_TENANT, box_no="OTHER-STN", station_id="stn-2", product_code="500X120", plate_count=0))
    return InventoryService(clean, AuditService(clean), _Imports(), None)


def as_user(user_id, fn):
    actor = Actor(id=user_id, type="user", roles=["STATION_USER"], permissions=[])
    return request_context.run(RequestContext(tenant_id=TEST_TENANT, actor=actor), fn)


def alloc(inv, db, user, order_id, position, boxes=("BOX-A",)):
    def run():
        with db.tx() as s:
            a = inv.allocate(s, order_id, position, "500X120", STATION, list(boxes))
            return a.laser_code, a.plate_id

    return as_user(user, run)


def test_refuses_an_unlocked_box(inv, clean):
    with pytest.raises(Problem) as e:
        alloc(inv, clean, "u1", "o1", "FRONT")
    assert (e.value.status, e.value.code) == (409, "box-not-locked")


def test_one_user_locks_a_box_at_a_time(inv):
    as_user("u1", lambda: inv.lock_boxes(STATION, ["BOX-A"]))
    with pytest.raises(Problem) as e:
        as_user("u2", lambda: inv.lock_boxes(STATION, ["BOX-A"]))
    assert e.value.code == "box-locked"
    as_user("u1", lambda: inv.release_boxes(["BOX-A"]))
    assert as_user("u2", lambda: inv.lock_boxes(STATION, ["BOX-A"]))


def test_refuses_boxes_of_another_station(inv):
    with pytest.raises(Problem) as e:
        as_user("u1", lambda: inv.lock_boxes(STATION, ["OTHER-STN"]))
    assert e.value.code == "box-station"


def test_allocates_in_order_and_moves_to_the_next_box(inv, clean):
    as_user("u1", lambda: inv.lock_boxes(STATION, ["BOX-A", "BOX-B"]))
    codes = [alloc(inv, clean, "u1", o, p, ("BOX-A", "BOX-B"))[0] for o, p in (("o1", "FRONT"), ("o1", "REAR"), ("o2", "FRONT"))]
    assert codes == ["AA0000000001", "AA0000000002", "BB0000000001"]
    with clean.tx() as s:
        assert s.scalar(select(PlateBox.status).where(PlateBox.box_no == "BOX-A")) == "EXHAUSTED"


def test_one_active_allocation_per_laser_code_and_position(inv, clean):
    as_user("u1", lambda: inv.lock_boxes(STATION, ["BOX-A"]))
    code, plate_id = alloc(inv, clean, "u1", "o1", "FRONT")
    with pytest.raises(IntegrityError), clean.tx() as s:
        s.add(PlateAllocation(tenant_id=TEST_TENANT, plate_id=plate_id, laser_code=code, order_id="o2", position="FRONT"))
    with pytest.raises(IntegrityError):
        alloc(inv, clean, "u1", "o1", "FRONT")


def test_switch_keeps_history(inv, clean):
    as_user("u1", lambda: inv.lock_boxes(STATION, ["BOX-A"]))
    first, _ = alloc(inv, clean, "u1", "o1", "FRONT")

    def switch(order_id, reason):
        with clean.tx() as s:
            inv.switch_laser(s, order_id, "FRONT", "BB0000000002", reason, STATION, "500X120")

    as_user("u1", lambda: switch("o1", "Wrong plate picked"))
    history = as_system(lambda: inv.allocation_history("o1"))
    assert [(h.laser_code, h.status) for h in history] == [(first, "CLOSED"), ("BB0000000002", "ACTIVE")]
    with clean.tx() as s:
        assert s.scalar(select(Plate.status).where(Plate.laser_code == first)) == "AVAILABLE"
    with pytest.raises(Problem) as e:
        as_user("u1", lambda: switch("o2", "x"))
    assert e.value.code == "laser-unavailable"


def test_scrap_closes_only_rejected_positions(inv, clean):
    as_user("u1", lambda: inv.lock_boxes(STATION, ["BOX-A"]))
    alloc(inv, clean, "u1", "o1", "FRONT")
    _, rear_plate = alloc(inv, clean, "u1", "o1", "REAR")

    def scrap():
        with clean.tx() as s:
            inv.close_positions(s, "o1", ["REAR"], "REJECTED", "SCRAPPED")

    as_system(scrap)
    assert [a.position for a in as_system(lambda: inv.active_allocations("o1"))] == ["FRONT"]
    with clean.tx() as s:
        assert s.get(Plate, rear_plate).status == "SCRAPPED"
