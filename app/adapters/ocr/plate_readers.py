import io
import logging
import os
import shutil
import threading

from app.core.ports import PlateReading

log = logging.getLogger("PlateOCR")

# Marker the test-image generators put in the file: the simulator, demo:e2e and the debug app's Test photo.
PLATE_MARKER = b"HSRP-PLATE:"

_WINDOWS_DEFAULT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def _tesseract_cmd() -> str | None:
    """TESSERACT_CMD, else tesseract on PATH, else the Windows installer's default location."""
    return os.environ.get("TESSERACT_CMD") or shutil.which("tesseract") or (_WINDOWS_DEFAULT if os.path.exists(_WINDOWS_DEFAULT) else None)


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
            img = ImageOps.grayscale(Image.open(io.BytesIO(image)))
            # A plate photo is one block of text (psm 6); greyscale keeps the coloured background and IND strip from
            # hiding it. Measured on simulator-style photos: 40/40 read, against 33/40 with automatic layout (psm 3).
            # Automatic layout is the fallback for photos where the block reading finds nothing.
            text, conf = self._ocr(img, 6)
            if not text:
                text, conf = self._ocr(img, 3)
        return PlateReading(text or None, conf, "tesseract")

    @staticmethod
    def _ocr(img, psm: int) -> tuple[str, int]:
        import pytesseract

        data = pytesseract.image_to_data(
            img,
            lang="eng",
            # Plates carry upper-case letters and digits only.
            config=f"--psm {psm} -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
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
