"""
Port helper (FastAPI port, D48): generates SQLAlchemy models from prisma/schema/*.prisma so the Python models match
the existing tables exactly. One models.py per owning module (the "// owner:" line). Run from the repo root:

    .venv/Scripts/python scripts/prisma_to_sqlalchemy.py

The schema itself is created by the Alembic baseline (the same SQL as the Prisma migrations); these models only
map it. After cut-over the Prisma files go and the generated models become the source; then delete this script.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "prisma" / "schema"

TYPES = {
    "String": ("str", "Text"),
    "Int": ("int", "Integer"),
    "Float": ("float", "Float"),
    "Boolean": ("bool", "Boolean"),
    "DateTime": ("datetime", "DateTime"),
    "Json": ("Any", "JSONB"),
    "Bytes": ("bytes", "LargeBinary"),
}


# Indexes the Prisma schema language cannot express (alembic/sql/0002_rules.sql); kept on the models so autogenerate
# does not try to drop them.
CUSTOM_INDEXES = {
    "core_inv_allocation": [
        """Index("core_inv_allocation_active_laser_code", "tenant_id", "laser_code", unique=True, postgresql_where=text("status = 'ACTIVE'"))""",
        """Index("core_inv_allocation_active_order_position", "order_id", "position", unique=True, postgresql_where=text("status = 'ACTIVE'"))""",
    ],
}


def snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name).lower()


def owner_package(owner: str) -> str:
    # "src/core/order-intake" -> "app/core/order_intake"
    return "app/" + "/".join(p.replace("-", "_") for p in owner.removeprefix("src/").split("/"))


def parse(text: str):
    owner = re.search(r"^// owner: (\S+)", text, re.M).group(1)
    models = []
    # Doc lines use [^\n]* (not .*): with re.S a greedy .* would swallow the models before this one.
    for m in re.finditer(r"((?:^[ \t]*///[^\n]*\n)*)^model (\w+) \{\n(.*?)^\}", text, re.M | re.S):
        doc = " ".join(line.strip().removeprefix("///").strip() for line in m.group(1).splitlines() if line.strip())
        name, body = m.group(2), m.group(3)
        table, fields, indexes = name, [], []
        pending_doc = []
        for raw in body.splitlines():
            line = raw.strip()
            if line.startswith("///"):
                pending_doc.append(line.removeprefix("///").strip())
                continue
            if not line or line.startswith("//"):
                continue
            if line.startswith("@@map"):
                table = re.search(r'"(.+)"', line).group(1)
                continue
            idx = re.match(r"@@(index|unique)\(\[([^\]]+)\]", line)
            if idx:
                indexes.append((idx.group(1) == "unique", [c.strip() for c in idx.group(2).split(",")]))
                continue
            if line.startswith("@@"):
                continue
            parts = line.split(None, 2)
            fname, ftype = parts[0], parts[1]
            attrs = parts[2] if len(parts) > 2 else ""
            optional = ftype.endswith("?")
            array = ftype.endswith("[]")
            base = ftype.rstrip("?").removesuffix("[]")
            col = re.search(r'@map\("([^"]+)"\)', attrs)
            default = re.search(r"@default\(((?:[^()]|\([^()]*\))*)\)", attrs)
            fields.append(
                {
                    "name": fname,
                    "attr": snake(fname),
                    "column": col.group(1) if col else fname,
                    "type": base,
                    "optional": optional,
                    "array": array,
                    "id": "@id" in attrs,
                    "unique": re.search(r"@unique\b", attrs) is not None,
                    "updated_at": "@updatedAt" in attrs,
                    "default": default.group(1) if default else None,
                    "doc": " ".join(pending_doc),
                }
            )
            pending_doc = []
        models.append({"name": name, "table": table, "fields": fields, "doc": doc, "indexes": indexes})
    return owner, models


def render_field(f) -> str:
    py, sa = TYPES[f["type"]]
    if f["array"]:
        py, sa = "list[str]", "ARRAY(Text)"
    if f["optional"]:
        py = f"{py} | None"
    args = [f'"{f["column"]}"', sa]
    if f["id"]:
        args.append("primary_key=True")
    d = f["default"]
    if d == "uuid()":
        args.append("default=new_id")
    elif d == "now()":
        args.append("default=utcnow")
    elif d == "autoincrement()":
        args.append("autoincrement=True")
    elif d in ("true", "false"):
        args.append(f"default={d.capitalize()}")
    elif d is not None and re.fullmatch(r"-?\d+(\.\d+)?", d):
        args.append(f"default={d}")
    elif d is not None and d.startswith('"'):
        args.append(f"default={d}")
    if f["updated_at"]:
        args.append("default=utcnow, onupdate=utcnow")
    if f["array"] and d is None and not f["optional"]:
        args.append("default=list")
    # Prisma creates scalar-list columns without NOT NULL.
    if f["optional"] or f["array"]:
        args.append("nullable=True")
    line = f"    {f['attr']}: Mapped[{py}] = mapped_column({', '.join(args)})"
    if f["doc"]:
        line = f"    # {f['doc']}\n{line}"
    return line


def table_args(m) -> list[str]:
    """Prisma index names: <table>_<columns>_idx, or _key for unique (Prisma creates unique indexes, not constraints)."""
    columns = {f["name"]: f["column"] for f in m["fields"]}
    specs = [(True, [f["name"]]) for f in m["fields"] if f["unique"]] + m["indexes"]
    out = []
    for unique, names in specs:
        cols = [columns[n] for n in names]
        suffix = "_key" if unique else "_idx"
        # Like Prisma: trim the body so the whole name fits PostgreSQL's 63-character limit.
        name = f"{m['table']}_{'_'.join(cols)}"[: 63 - len(suffix)] + suffix
        args = ", ".join([f'"{name}"'] + [f'"{c}"' for c in cols] + (["unique=True"] if unique else []))
        out.append(f"Index({args})")
    return out + CUSTOM_INDEXES.get(m["table"], [])


def main():
    by_pkg: dict[str, list] = {}
    for file in sorted(SCHEMA.glob("*.prisma")):
        owner, models = parse(file.read_text(encoding="utf-8"))
        by_pkg.setdefault(owner_package(owner), []).append((file.name, owner, models))
    for pkg, entries in by_pkg.items():
        target = ROOT / pkg / "models.py"
        target.parent.mkdir(parents=True, exist_ok=True)
        for d in [p for p in target.parents if p != ROOT and p.is_relative_to(ROOT / "app")]:
            (d / "__init__.py").touch(exist_ok=True)
        owner = entries[0][1]
        out = [
            f'"""Tables owned by {pkg.replace("/", ".")} (architecture rule 7).',
            "",
            f"Generated from prisma/schema/{', '.join(e[0] for e in entries)} by scripts/prisma_to_sqlalchemy.py during the FastAPI port;",
            'edit by hand after cut-over. The schema itself is created by the Alembic migrations."""',
            "",
            "from datetime import datetime  # noqa: F401",
            "from typing import Any  # noqa: F401",
            "",
            "from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401",
            "from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401",
            "from sqlalchemy.orm import Mapped, mapped_column",
            "",
            "from app.platform.db.base import Base, new_id, utcnow  # noqa: F401",
            "",
            f'OWNER = "{pkg.replace("/", ".")}"',
        ]
        for _, _, models in entries:
            for m in models:
                out += ["", ""]
                out.append(f"class {m['name']}(Base):")
                if m["doc"]:
                    out.append(f'    """{m["doc"]}"""')
                    out.append("")
                out.append(f'    __tablename__ = "{m["table"]}"')
                args = table_args(m)
                if args:
                    out.append("    __table_args__ = (")
                    out += [f"        {a}," for a in args]
                    out.append("    )")
                out.append("")
                out += [render_field(f) for f in m["fields"]]
        target.write_text("\n".join(out) + "\n", encoding="utf-8")
        print(f"{target.relative_to(ROOT)}: {sum(len(e[2]) for e in entries)} models")


if __name__ == "__main__":
    main()
