import logging
import re
import time

from sqlalchemy import select

from app.adapters.mock_state import MockStateService
from app.adapters.models import MockVahanVehicle
from app.core.ports import RegistryUnavailableError, VahanFitmentRequest, VahanLookupReply, VahanLookupRequest
from app.platform.db.session import Database

log = logging.getLogger("MockVAHAN")


class MockVahanAdapter:
    """Mock VAHAN. Serves vehicles from adp_mock_vahan_vehicle. The simulator switches its mode: normal, slow (4 s
    delay), down (connection error), not-found (every lookup misses)."""

    def __init__(self, db: Database, state: MockStateService):
        self.db = db
        self.state = state

    def _gate(self) -> str:
        mode = self.state.get("vahan.mode", "normal")
        if mode == "down":
            raise RegistryUnavailableError("VAHAN not reachable (mock is set to down)")
        if mode == "slow":
            time.sleep(4)
        return mode

    def _vehicle(self, regn_no: str) -> MockVahanVehicle | None:
        with self.db.tx() as s:
            return s.scalar(select(MockVahanVehicle).where(MockVahanVehicle.regn_no == regn_no.upper()))

    def lookup(self, req: VahanLookupRequest) -> VahanLookupReply:
        if self._gate() == "not-found":
            return VahanLookupReply("Vehicle details not found")
        v = self._vehicle(req.regn_no)
        if v is None:
            return VahanLookupReply("Vehicle details not found")
        if not v.chassis_no.endswith(req.chasis_no.upper()[-5:]) or not v.engine_no.endswith(req.engine_no.upper()[-5:]):
            return VahanLookupReply("Chassis number or engine number does not match")
        return VahanLookupReply(
            message="Success",
            fuel=v.fuel,
            maker=v.maker,
            vch_type=v.vch_type,
            norms=v.norms,
            vch_catg=v.vch_catg,
            regn_date=v.regn_date,
            hsrp_front_laser_code=v.hsrp_front_laser_code or "",
            hsrp_rear_laser_code=v.hsrp_rear_laser_code or "",
            state_cd=v.state_cd,
            off_cd=v.off_cd,
        )

    def record_fitment(self, req: VahanFitmentRequest) -> str:
        self._gate()
        with self.db.tx() as s:
            v = s.scalar(select(MockVahanVehicle).where(MockVahanVehicle.regn_no == req.regn_no.upper()))
            if v is None:
                return f"Vehicle {req.regn_no} not found"
            # A fixture vehicle that makes VAHAN answer with text the adapter cannot recognise.
            if v.scenario == "garbled-post":
                return "ERR#5503 <html>Gateway Timeout</html>"
            if not re.fullmatch(r"\d{2}-\d{2}-\d{4}", req.fixationdate):
                return "Invalid fixation date format"
            v.hsrp_front_laser_code = req.hsrp_front_laser_code or v.hsrp_front_laser_code
            v.hsrp_rear_laser_code = req.hsrp_rear_laser_code or v.hsrp_rear_laser_code
        log.info("Fitment recorded for %s", req.regn_no)
        return f"HSRP details updated successfully for {req.regn_no}"

    def upload_inventory(self, station_code: str, laser_codes: list[str]) -> None:
        log.info("uploadInventory stub: %s codes from %s", len(laser_codes), station_code)


class RealVahanAdapter:
    """Placeholder for the real VAHAN integration. Not built in the prototype (the contract is unconfirmed, D3)."""

    def __init__(self, db: Database, state: MockStateService):
        pass

    def _fail(self, *args, **kwargs):
        raise RuntimeError("Real VAHAN adapter is not implemented. Set VAHAN_ADAPTER=mock.")

    lookup = record_fitment = upload_inventory = _fail
