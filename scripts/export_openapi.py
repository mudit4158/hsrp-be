"""Writes openapi.json (the API description with the shared contracts) at the repo root. The web app's
`pnpm contracts:sync` generates its TypeScript contracts from it, so run this after changing a route, a request model
or an enum, and commit the file. `--check` exits 1 when the file is out of date (the pytest suite checks it too).

    .venv/Scripts/python scripts/export_openapi.py [--check]"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.contracts.openapi import OPENAPI_FILE, render  # noqa: E402
from app.main import app  # noqa: E402


def main() -> int:
    text = render(app)
    current = OPENAPI_FILE.read_text(encoding="utf-8") if OPENAPI_FILE.exists() else ""
    if "--check" in sys.argv:
        if text != current:
            print("openapi.json is out of date: run .venv/Scripts/python scripts/export_openapi.py")
            return 1
        print("openapi.json is current")
        return 0
    OPENAPI_FILE.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {OPENAPI_FILE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
