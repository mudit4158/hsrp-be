"""Architecture rule 7: each module owns its tables; other modules use its service, not its tables.

Every `models.py` under app/ belongs to the package it sits in (its OWNER). This check fails when code in one module
imports another module's models or names a table (raw SQL) that another module owns. The seed, the tests, the model
registry (app/models.py) and the migrations are exempt: they deal with every module's tables.

    .venv/Scripts/python scripts/check_module_tables.py"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
EXEMPT = ("app/seed/", "app/models.py", "app/container.py", "app/platform/db/migrate_on_start.py")
TABLE_RE = re.compile(r"\b((?:core|util|adp|platform)_[a-z0-9_]+)\b")


def owners() -> tuple[dict[str, str], dict[str, str]]:
    """models module ('app.core.inventory.models') → owner package, and table name → owner package."""
    module_owner, table_owner = {}, {}
    for f in APP.rglob("models.py"):
        if f == APP / "models.py":
            continue
        pkg = ".".join(f.relative_to(ROOT).with_suffix("").parts[:-1])
        module_owner[f"{pkg}.models"] = pkg
        for name in re.findall(r'__tablename__ = "([^"]+)"', f.read_text(encoding="utf-8")):
            table_owner[name] = pkg
    return module_owner, table_owner


def main() -> int:
    module_owner, table_owner = owners()
    packages = sorted(set(module_owner.values()), key=len, reverse=True)
    errors = []
    for f in sorted(APP.rglob("*.py")):
        rel = f.relative_to(ROOT).as_posix()
        if rel.startswith(EXEMPT) or f.name == "models.py":
            continue
        dotted = ".".join(f.relative_to(ROOT).with_suffix("").parts)
        mine = next((p for p in packages if dotted == p or dotted.startswith(p + ".")), None)
        text = f.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(text)):
            names = []
            if isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
            elif isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            for n in names:
                owner = module_owner.get(n)
                if owner and owner != mine:
                    errors.append(f"{rel}:{node.lineno} imports {n} (owned by {owner})")
        for i, line in enumerate(text.splitlines(), 1):
            for t in TABLE_RE.findall(line):
                owner = table_owner.get(t)
                if owner and owner != mine:
                    errors.append(f"{rel}:{i} touches table {t} (owned by {owner})")
    if errors:
        print("Module table ownership (rule 7) violated:")
        print("\n".join(f"  {e}" for e in errors))
        return 1
    print(f"Module table ownership (rule 7): OK ({len(module_owner)} model modules, {len(table_owner)} tables)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
