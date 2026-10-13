"""Ports the core depends on. Each has a mock adapter now and a real one later (see app/adapters). The utility ports
(MessageSender, PaymentProvider, FileStore) live with their utilities."""

from dataclasses import dataclass
from typing import Any, Protocol

from app.contracts.schemas import OemOrderRequest


# ---------- VAHAN ----------
# Field names follow a public sample from one state's VAHAN integration; the real contract is unconfirmed (D3).
@dataclass
class VahanLookupRequest:
    regn_no: str
    # Last five characters of the chassis number.
    chasis_no: str
    # Last five characters of the engine number.
    engine_no: str
    user_id: str

    def wire(self) -> dict[str, str]:
        return {"regnNO": self.regn_no, "chasisNo": self.chasis_no, "engineNo": self.engine_no, "userId": self.user_id}


@dataclass
class VahanLookupReply:
    message: str
    fuel: str = ""
    maker: str = ""
    vch_type: str = ""
    norms: str = ""
    vch_catg: str = ""
    regn_date: str = ""
    hsrp_front_laser_code: str = ""
    hsrp_rear_laser_code: str = ""
    state_cd: str = ""
    off_cd: str = ""

    def wire(self) -> dict[str, str]:
        """The reply as VAHAN names its fields (stored in call logs and validation results)."""
        return {
            "message": self.message,
            "fuel": self.fuel,
            "maker": self.maker,
            "vchType": self.vch_type,
            "norms": self.norms,
            "vchCatg": self.vch_catg,
            "regnDate": self.regn_date,
            "hsrpFrontLaserCode": self.hsrp_front_laser_code,
            "hsrpRearLaserCode": self.hsrp_rear_laser_code,
            "stateCd": self.state_cd,
            "offCd": self.off_cd,
        }


@dataclass
class VahanFitmentRequest:
    regn_no: str
    chasis_no: str
    ordertype: str
    hsrp_front_laser_code: str
    hsrp_rear_laser_code: str
    # dd-mm-yyyy
    fixationdate: str

    def wire(self) -> dict[str, str]:
        return {
            "regnNO": self.regn_no,
            "chasisNo": self.chasis_no,
            "ordertype": self.ordertype,
            "hsrpFrontLaserCode": self.hsrp_front_laser_code,
            "hsrpRearLaserCode": self.hsrp_rear_laser_code,
            "fixationdate": self.fixationdate,
        }


class RegistryUnavailableError(Exception):
    """The registry cannot be reached; callers retry."""


class VehicleRegistry(Protocol):
    def lookup(self, req: VahanLookupRequest) -> VahanLookupReply: ...

    def record_fitment(self, req: VahanFitmentRequest) -> str:
        """VAHAN's reply text; the caller parses it for success."""
        ...

    def upload_inventory(self, station_code: str, laser_codes: list[str]) -> None: ...


# ---------- OEM ----------
class OrderSource(Protocol):
    """Inbound order channel from an OEM system, and the status callback back to it."""

    def to_canonical(self, oem_code: str, payload: Any) -> OemOrderRequest: ...

    def notify_status(self, oem_code: str, order_ref: str, status: str, reason: str | None = None) -> None: ...


class OemVehicleCatalog(Protocol):
    def check(self, oem_code: str, chassis_no: str) -> dict[str, Any]:
        """{found, model?}"""
        ...


# ---------- plate OCR ----------
@dataclass
class PlateReading:
    """What an OCR engine read from a plate photo. `text` is None when nothing readable was found."""

    text: str | None
    # 0–100 where the engine reports one.
    confidence: int | None
    engine: str


class PlateReader(Protocol):
    """Reads the registration number off a number-plate photo (embossed plate at the station, fitted plate at the
    dealer). Adapters: tesseract (real OCR, runs locally) and mock (reads the plate text test images embed)."""

    def read(self, image: bytes, mime_type: str) -> PlateReading: ...
