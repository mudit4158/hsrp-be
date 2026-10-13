"""CSV parsing and writing, and the column mapping profiles that turn a source file's columns into target fields."""

import csv
import io
import json
import re
from typing import Any

BOM = chr(0xFEFF)


def parse_csv(text: str, delimiter: str = ",") -> list[dict[str, str]]:
    """Header row gives the keys; values trimmed; empty lines skipped; short rows allowed (csv-parse's options)."""
    text = text.removeprefix(BOM)
    # Blank (or whitespace-only) lines are skipped; a line of empty fields such as "," is a record.
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if not (len(r) == 0 or (len(r) == 1 and not r[0].strip()))]
    if not rows:
        return []
    header = [h.strip() for h in rows[0]]
    return [{header[i]: v.strip() for i, v in enumerate(r) if i < len(header)} for r in rows[1:]]


def _cell(v: Any) -> str:
    if v is None:
        s = ""
    elif isinstance(v, dict | list):
        s = json.dumps(v, separators=(",", ":"))
    elif isinstance(v, bool):
        s = "true" if v else "false"
    elif isinstance(v, float) and v.is_integer():
        s = str(int(v))
    else:
        s = str(v)
    return '"' + s.replace('"', '""') + '"' if re.search(r'[",\n\r]', s) else s


def to_csv(rows: list[dict[str, Any]], columns: list[dict[str, str]] | None = None) -> str:
    cols = columns or [{"key": k, "label": k} for k in (rows[0].keys() if rows else [])]
    lines = [",".join(_cell(c.get("label") or c["key"]) for c in cols)]
    for r in rows:
        lines.append(",".join(_cell(r.get(c["key"])) for c in cols))
    return "\r\n".join(lines) + "\r\n"


def template_csv(profile: dict[str, Any]) -> str:
    """A CSV with the profile's column headers and one example row: the template a source fills in."""
    keys = profile.get("columnOrder") or list(profile["columns"].keys())
    cols = [profile["columns"][k] for k in keys if k in profile["columns"]]
    return to_csv([{c["from"]: c.get("example", "") for c in cols}], [{"key": c["from"], "label": c["from"]} for c in cols])


def map_row(raw: dict[str, str], profile: dict[str, Any]) -> tuple[dict[str, str], list[str]]:
    """Maps one source row to target fields with the profile; returns errors instead of raising."""
    mapped: dict[str, str] = {}
    errors: list[str] = []
    for target, m in profile["columns"].items():
        v = raw.get(m["from"])
        if v is None or v == "":
            v = m.get("default") or ""
        if not v:
            if m.get("required"):
                errors.append(f"{m['from']} is required")
            continue
        transform = m.get("transform")
        if transform == "upper":
            v = v.strip().upper()
        elif transform == "lower":
            v = v.strip().lower()
        elif transform == "digits":
            v = re.sub(r"\D", "", v)
        elif transform == "date-dmy":
            mt = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", v)
            if not mt:
                errors.append(f"{m['from']} must be a date like 31-12-2024")
            else:
                v = f"{mt.group(3)}-{mt.group(2).zfill(2)}-{mt.group(1).zfill(2)}"
        else:
            v = v.strip()
        mapped[target] = v
    return mapped, errors
