"""Port helper (D48): lists the routes the NestJS API has that the FastAPI app does not (and the reverse), from each
side's OpenAPI document. Run from the repo root with both APIs up:

    .venv/Scripts/python scripts/route_parity.py [NEST_URL] [PY_URL]

Defaults: http://localhost:3000 and http://localhost:3001. Deleted with the NestJS code at cut-over."""

import json
import re
import sys
import urllib.request

# The detached customer portal (D37) is not ported.
IGNORED = re.compile(r"^/api/v1/public/")


def routes(base: str) -> set[tuple[str, str]]:
    with urllib.request.urlopen(f"{base}/api/docs-json", timeout=10) as r:
        doc = json.load(r)
    out = set()
    for path, ops in doc.get("paths", {}).items():
        norm = re.sub(r"\{[^}]+\}", "{}", path.rstrip("/") or "/")
        if IGNORED.match(norm):
            continue
        for method in ops:
            if method in ("get", "post", "put", "patch", "delete"):
                out.add((method.upper(), norm))
    return out


def main() -> int:
    nest_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
    py_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3001"
    nest, py = routes(nest_url), routes(py_url)
    missing = sorted(nest - py, key=lambda r: (r[1], r[0]))
    extra = sorted(py - nest, key=lambda r: (r[1], r[0]))
    print(f"NestJS {len(nest)} routes, FastAPI {len(py)}; missing in FastAPI: {len(missing)}, only in FastAPI: {len(extra)}")
    for m, p in missing:
        print(f"  missing  {m:6} {p}")
    for m, p in extra:
        print(f"  extra    {m:6} {p}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
