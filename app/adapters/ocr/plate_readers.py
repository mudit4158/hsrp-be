import io
import logging
import os
import re
import shutil
import threading
from typing import Any

from app.core.ports import PlateReading

log = logging.getLogger("PlateOCR")

# Marker the test-image generators put in the file: the simulator, demo:e2e and the debug app's Test photo.
PLATE_MARKER = b"HSRP-PLATE:"

_WINDOWS_DEFAULT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def _tesseract_cmd() -> str | None:
    """TESSERACT_CMD, else tesseract on PATH, else the Windows installer's default location."""
    return os.environ.get("TESSERACT_CMD") or shutil.which("tesseract") or (_WINDOWS_DEFAULT if os.path.exists(_WINDOWS_DEFAULT) else None)


PLATE_PATTERN = re.compile(r"[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}")


def _compact(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def _plate_area(photo: Any) -> Any:
    """The white number plate of a photo, cropped inside its border, with coloured marks whited out; None if the
    photo has no clear white plate."""
    from PIL import Image, ImageChops, ImageOps

    r, g, b = photo.split()
    lightest, darkest = ImageChops.lighter(ImageChops.lighter(r, g), b), ImageChops.darker(ImageChops.darker(r, g), b)
    box = darkest.point(lambda p: 255 if p > 240 else 0).getbbox()
    if box is None:
        return None
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w < 100 or h < 30 or w < 2 * h:
        return None
    inner = (x0 + int(w * 0.02), y0 + int(h * 0.10), x1 - int(w * 0.02), y1 - int(h * 0.10))
    gray = ImageOps.grayscale(photo.crop(inner))
    coloured = ImageChops.subtract(lightest, darkest).crop(inner).point(lambda p: 255 if p > 60 else 0)
    gray.paste(255, mask=coloured)
    return ImageOps.expand(gray, border=20, fill=255) if isinstance(gray, Image.Image) else None


class TesseractPlateReader:
    """Real OCR with the Tesseract engine, run locally (no outside service). The Docker image installs tesseract-ocr;
    on Windows the UB Mannheim installer's default path is found automatically. One image at a time."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    def read(self, image: bytes, mime_type: str = "image/png") -> PlateReading:
        import pytesseract
        from PIL import Image, ImageOps

        cmd = _tesseract_cmd()
        if cmd is None:
            raise RuntimeError("Tesseract is not installed (set TESSERACT_CMD, or OCR_ADAPTER=mock)")
        pytesseract.pytesseract.tesseract_cmd = cmd
        with self._lock:
            photo = Image.open(io.BytesIO(image)).convert("RGB")
            # First the plate itself: the white plate cropped inside its border, coloured marks (the blue IND strip)
            # whited out, read as one line. On headless-Chrome simulator photos this reads 10/10, where the whole
            # photo reads 8/10 (the strip and border bleed into the first letters).
            text, conf = "", 0
            plate = _plate_area(photo)
            if plate is not None:
                text, conf = self._ocr(plate, 7)
            # Then the whole photo with automatic layout (real camera photos, or no white plate found).
            if not PLATE_PATTERN.search(_compact(text)):
                text, conf = self._ocr(ImageOps.grayscale(photo), 3)
        return PlateReading(text or None, conf, "tesseract")

    @staticmethod
    def _ocr(img, psm: int) -> tuple[str, int]:
        import pytesseract

        data = pytesseract.image_to_data(
            img,
            lang="eng",
            # Plates carry upper-case letters and digits only. The space keeps words apart (without it Tesseract
            # returns one merged word with confidence 0).
            config=f'--psm {psm} -c "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 "',
            output_type=pytesseract.Output.DICT,
        )
        words = [(w.strip(), float(c)) for w, c in zip(data["text"], data["conf"], strict=False) if w and w.strip()]
        confs = [c for _, c in words if c >= 0]
        return " ".join(w for w, _ in words), round(sum(confs) / len(confs)) if confs else 0


class MockPlateReader:
    """Mock OCR for unit tests and for runs without the OCR engine: 'reads' the plate text that test images embed after
    PLATE_MARKER. A real camera photo has no marker, so the mock reads nothing and the check fails."""

    def read(self, image: bytes, mime_type: str = "image/png") -> PlateReading:
        at = image.rfind(PLATE_MARKER)
        if at < 0:
            return PlateReading(None, None, "mock")
        start = at + len(PLATE_MARKER)
        chunk = image[start : start + 40].decode("latin-1")
        text = chunk.replace("\r", "\n").replace("\0", "\n").split("\n")[0].strip()
        return PlateReading(text or None, 100, "mock")


def plate_reader(value: str):
    """Plate OCR has two working adapters (D45): real local OCR (tesseract) and the mock used by unit tests."""
    if value == "tesseract":
        return TesseractPlateReader()
    if value == "mock":
        return MockPlateReader()
    raise RuntimeError(f'OCR_ADAPTER must be "tesseract" or "mock", got "{value}"')
