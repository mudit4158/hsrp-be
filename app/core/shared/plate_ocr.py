"""The plate OCR rule (D45)."""

import re
from dataclasses import dataclass

from app.core.ports import PlateReading


@dataclass
class PlateOcrResult:
    # PASS | FAIL
    result: str
    read: str | None
    reason: str


def normalize_plate(s: str | None) -> str:
    """Letters and digits only, upper case: 'WB 02 KF-5437' → 'WB02KF5437'."""
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def format_plate(regn_no: str) -> str:
    """'WB02KF5437' → 'WB 02 KF 5437', the way the plate prints it."""
    m = re.fullmatch(r"([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})", normalize_plate(regn_no))
    return " ".join(p for p in m.groups() if p) if m else regn_no


def judge_plate(expected_regn_no: str, reading: PlateReading) -> PlateOcrResult:
    """Passes only when the text read from the photo contains the ordered registration number exactly (spaces and
    punctuation ignored); anything else, including nothing read, fails."""
    expected = normalize_plate(expected_regn_no)
    read = normalize_plate(reading.text)
    if not read:
        return PlateOcrResult("FAIL", None, "No registration number could be read from the photo")
    if expected in read:
        return PlateOcrResult("PASS", read, f"Read {format_plate(expected)}")
    shown = re.sub(r"\s+", " ", (reading.text or "").strip())
    return PlateOcrResult("FAIL", read, f'Photo reads "{shown}", the order is for {format_plate(expected)}')
