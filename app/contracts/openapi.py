"""The OpenAPI document with the shared contracts added: every enum of app.contracts.enums as a named schema (with
`x-const-name`, the constant the web app generates), the status labels as `x-labels` on OrderStatus, and every request
body model. The web app generates src/contracts/index.ts from the exported file (openapi.json, D48)."""

import inspect
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel

from app.contracts import schemas
from app.contracts.enums import CONSTANTS, STATUS_LABELS

OPENAPI_FILE = Path(__file__).resolve().parents[2] / "openapi.json"


def build(app: FastAPI) -> dict[str, Any]:
    doc = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
    comps = doc.setdefault("components", {}).setdefault("schemas", {})
    for const, (name, values) in CONSTANTS.items():
        comps[name] = {"type": "string", "enum": list(values), "x-const-name": const}
    comps["OrderStatus"]["x-labels"] = STATUS_LABELS
    # Every request contract, also those no route takes as a plain JSON body (multipart forms, internal use).
    models = [m for _, m in inspect.getmembers(schemas, inspect.isclass) if issubclass(m, BaseModel) and m.__module__ == schemas.__name__]
    for m in models:
        schema = m.model_json_schema(by_alias=True, ref_template="#/components/schemas/{model}")
        for name, sub in schema.pop("$defs", {}).items():
            comps.setdefault(name, sub)
        comps.setdefault(m.__name__, schema)
    doc["components"]["schemas"] = dict(sorted(comps.items()))
    return doc


def install(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]


def render(app: FastAPI) -> str:
    return json.dumps(build(app), indent=2, ensure_ascii=False) + "\n"
