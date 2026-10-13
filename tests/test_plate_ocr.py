"""Port of src/core/shared/plate-ocr.spec.ts, plus a smoke test of the real Tesseract reader."""

import io

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.adapters.ocr.plate_readers import PLATE_MARKER, MockPlateReader, TesseractPlateReader, _tesseract_cmd
from app.core.ports import PlateReading
from app.core.shared.plate_ocr import format_plate, judge_plate, normalize_plate


def reading(text):
    return PlateReading(text, 90, "test")


def test_normalises_and_formats():
    assert normalize_plate("wb 02 kf-5437") == "WB02KF5437"
    assert format_plate("WB02KF5437") == "WB 02 KF 5437"
    assert format_plate("OD5A123") == "OD 5 A 123"


def test_judge():
    r = judge_plate("WB02KF5437", reading("WB 02 KF 5437"))
    assert (r.result, r.read) == ("PASS", "WB02KF5437")
    assert judge_plate("WB02KF5437", reading("8 IND WB 02 KF 5437 |")).result == "PASS"
    r = judge_plate("WB02KF5437", reading("WB 02 KF 5438"))
    assert (r.result, r.read) == ("FAIL", "WB02KF5438") and "the order is for WB 02 KF 5437" in r.reason
    assert (judge_plate("WB02KF5437", reading(None)).result, judge_plate("WB02KF5437", reading(None)).read) == ("FAIL", None)
    assert judge_plate("WB02KF5437", reading("  ")).result == "FAIL"


def test_mock_reader():
    img = b"\x89PNG" + PLATE_MARKER + b"WB 02 KF 5437"
    r = MockPlateReader().read(img)
    assert (r.text, r.engine) == ("WB 02 KF 5437", "mock")
    assert MockPlateReader().read(b"\xff\xd8\xff\xd9").text is None


def sim_plate(text: str) -> bytes:
    """The simulator's plate photo (sim/core/plate-image.ts): grey backdrop, white plate, IND strip, Arial bold squeezed
    to 690 px, a caption, JPEG."""
    img = Image.new("RGB", (960, 520))
    d = ImageDraw.Draw(img)
    for y in range(520):
        d.line([(0, y), (960, y)], fill=tuple(int(a + (b - a) * y / 519) for a, b in zip((0x6B, 0x7A, 0x89), (0x3F, 0x4B, 0x57), strict=True)))
    d.rectangle((70, 170, 890, 350), fill="white")
    d.rectangle((78, 178, 882, 342), outline="#111827", width=7)
    d.rectangle((84, 184, 148, 336), fill="#1d4ed8")
    d.text((92, 300), "IND", fill="white", font=ImageFont.truetype("arialbd.ttf", 24))
    font = ImageFont.truetype("arialbd.ttf", 100)
    left, top, right, bottom = d.textbbox((0, 0), text, font=font, anchor="lm")
    layer = Image.new("RGBA", (right - left + 4, bottom - top + 4), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((2 - left, 2 - top), text, fill="#111827", font=font, anchor="lm")
    if layer.width > 690:
        layer = layer.resize((690, layer.height), Image.LANCZOS)
    img.paste(layer, (170 + left - 2, 262 + top - 2), layer)
    d.text((24, 480), "QC photo", fill="white", font=ImageFont.truetype("arial.ttf", 20))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def _has_arial() -> bool:
    try:
        ImageFont.truetype("arialbd.ttf", 10)
        return True
    except OSError:
        return False


@pytest.mark.skipif(_tesseract_cmd() is None or not _has_arial(), reason="Tesseract or Arial missing")
def test_tesseract_reads_a_plate():
    r = TesseractPlateReader().read(sim_plate("WB 02 KF 5437"))
    assert r.engine == "tesseract"
    assert judge_plate("WB02KF5437", r).result == "PASS", r.text
    assert judge_plate("WB02KF5438", r).result == "FAIL"
