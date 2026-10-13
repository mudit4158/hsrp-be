"""Renders every error as RFC 7807 problem JSON, the same bodies the NestJS ProblemFilter produced."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError, NoResultFound
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.platform.http.json import to_jsonable
from app.platform.http.problem import Problem

log = logging.getLogger("problem")


def problem_body(status: int, code: str, title: str, detail: str | None = None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"type": f"https://hsrp.local/problems/{code}", "title": title, "status": status}
    if detail is not None:
        body["detail"] = detail
    if extra:
        body.update(extra)
    return body


def _respond(request: Request, body: dict[str, Any]) -> JSONResponse:
    body["instance"] = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    return JSONResponse(to_jsonable(body), status_code=body["status"], media_type="application/problem+json")


def _validation(errors: list[dict[str, Any]]) -> dict[str, Any]:
    out = []
    for e in errors:
        # FastAPI prefixes the location ("body", "query", "path"); the NestJS API reported the field path only.
        loc = [str(p) for p in e.get("loc", ())]
        if loc and loc[0] in ("body", "query", "path", "header"):
            loc = loc[1:]
        out.append({"path": ".".join(loc), "message": e.get("msg", "Invalid value")})
    return problem_body(400, "validation", "Validation failed", "One or more fields are invalid", {"errors": out})


def install(app: FastAPI) -> None:
    @app.exception_handler(Problem)
    async def _problem(request: Request, e: Problem):
        return _respond(request, problem_body(e.status, e.code or "error", e.title, e.detail, e.extra))

    @app.exception_handler(RequestValidationError)
    async def _request_validation(request: Request, e: RequestValidationError):
        return _respond(request, _validation(list(e.errors())))

    @app.exception_handler(ValidationError)
    async def _model_validation(request: Request, e: ValidationError):
        return _respond(request, _validation(list(e.errors())))

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, e: IntegrityError):
        sqlstate = getattr(e.orig, "sqlstate", None)
        if sqlstate == "23505":
            diag = getattr(e.orig, "diag", None)
            target = getattr(diag, "constraint_name", None) or "a unique field"
            return _respond(request, problem_body(409, "duplicate", "Conflict", f"Duplicate value for {target}"))
        log.exception("Integrity error", exc_info=e)
        return _respond(request, problem_body(500, "internal", "Internal server error", "Something went wrong. The error has been logged."))

    @app.exception_handler(NoResultFound)
    async def _no_result(request: Request, e: NoResultFound):
        return _respond(request, problem_body(404, "not-found", "Not found", "Record not found"))

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, e: StarletteHTTPException):
        if e.status_code in (404, 405) and e.detail in ("Not Found", "Method Not Allowed"):
            # No route matched: Express answered 404 "Cannot <METHOD> <path>" for both cases.
            return _respond(request, problem_body(404, "http", "NotFound", f"Cannot {request.method} {request.url.path}"))
        code = "rate-limited" if e.status_code == 429 else "http"
        titles = {429: "ThrottlerException"}
        return _respond(request, problem_body(e.status_code, code, titles.get(e.status_code, "Http"), str(e.detail)))

    @app.exception_handler(Exception)
    async def _internal(request: Request, e: Exception):
        log.exception("Unhandled error", exc_info=e)
        return _respond(request, problem_body(500, "internal", "Internal server error", "Something went wrong. The error has been logged."))
