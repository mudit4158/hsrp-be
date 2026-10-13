"""A small layout language stored as JSON in util_doc_template, so print formats are data, not code. Values are
`{{path.to.value}}` placeholders resolved against the data object. Drawn with ReportLab, top-down like PDFKit."""

import io
import re
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, A5
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas

PAGE_SIZES = {"A4": A4, "A5": A5, "STICKER": (288, 216)}
_PLACEHOLDER = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")


def get_path(data: Any, path: str) -> Any:
    for k in path.split("."):
        if data is None:
            return None
        data = data.get(k) if isinstance(data, dict) else getattr(data, k, None)
    return data


def _js(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def fill(text: str, data: Any) -> str:
    def sub(m: re.Match[str]) -> str:
        v = get_path(data, m.group(1))
        return "" if v is None else _js(v)

    return _PLACEHOLDER.sub(sub, text)


class _Page:
    """Cursor-based drawing (y measured from the top, as in PDFKit)."""

    def __init__(self, c: Canvas, size: tuple[float, float], margin: float):
        self.c = c
        self.width, self.height = size
        self.margin = margin
        self.y = margin

    @property
    def content_width(self) -> float:
        return self.width - self.margin * 2

    def new_page(self) -> None:
        self.c.showPage()
        self.y = self.margin

    def text(self, text: str, x: float, width: float, size: float, bold: bool = False, align: str = "left", color: str = "#000000") -> float:
        """Draws wrapped text at the cursor; returns its height and moves the cursor below it."""
        font = "Helvetica-Bold" if bold else "Helvetica"
        lines = simpleSplit(text, font, size, width) or [""]
        leading = size * 1.16
        self.c.setFont(font, size)
        self.c.setFillColor(HexColor(color))
        for i, line in enumerate(lines):
            baseline = self.height - (self.y + size + i * leading)
            if align == "center":
                self.c.drawCentredString(x + width / 2, baseline, line)
            elif align == "right":
                self.c.drawRightString(x + width, baseline, line)
            else:
                self.c.drawString(x, baseline, line)
        h = len(lines) * leading
        self.y += h
        return h

    def line(self, x1: float, y: float, x2: float, color: str = "#000000") -> None:
        self.c.setStrokeColor(HexColor(color))
        self.c.line(x1, self.height - y, x2, self.height - y)


def render_pdf(layout: dict[str, Any], data: dict[str, Any]) -> bytes:
    margin = layout.get("margin", 40)
    size = PAGE_SIZES.get(layout.get("page") or "A4", A4)
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=size)
    page = _Page(c, size, margin)
    repeat = layout.get("repeatFor")
    pages = (get_path(data, repeat) or []) if repeat else [data]
    first = True
    for page_data in pages or [data]:
        if not first:
            page.new_page()
        first = False
        scope = {**data, **page_data} if repeat else page_data
        for el in layout.get("elements", []):
            _draw(page, el, scope)
    c.showPage()
    c.save()
    return buf.getvalue()


def _draw(p: _Page, el: dict[str, Any], data: dict[str, Any]) -> None:
    m, width = p.margin, p.content_width
    kind = el.get("type")
    if kind == "heading":
        p.text(fill(el["text"], data), m, width, el.get("size", 16), True, el.get("align", "left"))
        p.y += el.get("size", 16) * 0.4
    elif kind == "text":
        p.text(fill(el["text"], data), m, width, el.get("size", 10), bool(el.get("bold")), el.get("align", "left"))
    elif kind == "big":
        p.text(fill(el["text"], data), m, width, el.get("size", 28), True, el.get("align", "center"))
    elif kind == "fields":
        cols = el.get("columns", 2)
        col_w = width / cols
        row_y = p.y
        row_bottom = p.y
        for i, item in enumerate(el.get("items", [])):
            col = i % cols
            if col == 0 and i > 0:
                row_y = row_bottom + 4
            x = m + col * col_w
            p.y = row_y
            p.text(item["label"], x, col_w - 8, 8, color="#555555")
            p.y = row_y + 10
            p.text(fill(item["value"], data) or "-", x, col_w - 8, 10, True)
            row_bottom = max(row_bottom, p.y)
        p.y = row_bottom + 10
    elif kind == "table":
        rows = get_path(data, el["source"]) or []
        columns = el["columns"]
        total = sum(col.get("width", 1) for col in columns)
        widths = [col.get("width", 1) / total * width for col in columns]

        def draw_row(cells: list[str], bold: bool) -> None:
            if p.y > p.height - m - 40:
                p.new_page()
            top, x, h = p.y, m, 0.0
            for idx, cell in enumerate(cells):
                p.y = top + 3
                h = max(h, p.text(cell, x + 3, widths[idx] - 6, 9, bold))
                x += widths[idx]
            p.line(m, top + h + 6, m + width, "#bbbbbb")
            p.y = top + h + 8

        draw_row([col["header"] for col in columns], True)
        for idx, r in enumerate(rows):
            draw_row([fill(col["value"], {**data, **r, "rowNo": idx + 1}) for col in columns], False)
        p.y += 6
    elif kind == "band":
        if el.get("when") and not get_path(data, el["when"]):
            return
        top = p.y
        p.c.setFillColor(HexColor(el["color"]))
        p.c.rect(m, p.height - top - 22, width, 22, stroke=0, fill=1)
        p.y = top + 6
        p.text(fill(el["text"], data), m, width, 11, True, "center", el.get("textColor", "#ffffff"))
        p.y = top + 28
    elif kind == "rule":
        p.line(m, p.y, m + width)
        p.y += 6
    elif kind == "spacer":
        p.y += el.get("height", 12)
    elif kind == "signature":
        p.y += 24
        labels = el.get("labels", [])
        w = width / max(1, len(labels))
        top = p.y
        for idx, label in enumerate(labels):
            p.line(m + idx * w + 10, top, m + (idx + 1) * w - 10)
            p.y = top + 4
            p.text(label, m + idx * w + 10, w - 20, 8, align="center")
        p.y = top + 16
