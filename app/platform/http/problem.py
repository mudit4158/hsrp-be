"""RFC 7807 problems. Raise from any layer; the exception handlers render them as application/problem+json."""

from typing import Any


class Problem(Exception):
    def __init__(self, status: int, title: str, detail: str | None = None, code: str | None = None, extra: dict[str, Any] | None = None):
        super().__init__(detail or title)
        self.status = status
        self.title = title
        self.detail = detail
        self.code = code
        self.extra = extra or {}

    @staticmethod
    def bad_request(detail: str, code: str = "bad-request", extra: dict[str, Any] | None = None) -> "Problem":
        return Problem(400, "Bad request", detail, code, extra)

    @staticmethod
    def unauthorized(detail: str = "Sign in required") -> "Problem":
        return Problem(401, "Unauthorized", detail, "unauthorized")

    @staticmethod
    def forbidden(detail: str = "You do not have permission for this action") -> "Problem":
        return Problem(403, "Forbidden", detail, "forbidden")

    @staticmethod
    def not_found(what: str) -> "Problem":
        return Problem(404, "Not found", f"{what} not found", "not-found")

    @staticmethod
    def conflict(detail: str, code: str = "conflict", extra: dict[str, Any] | None = None) -> "Problem":
        return Problem(409, "Conflict", detail, code, extra)

    @staticmethod
    def unprocessable(detail: str, code: str = "unprocessable", extra: dict[str, Any] | None = None) -> "Problem":
        return Problem(422, "Unprocessable entity", detail, code, extra)

    @staticmethod
    def payment_required(detail: str, code: str = "insufficient-funds") -> "Problem":
        return Problem(402, "Payment required", detail, code)


class NonRetryableError(Exception):
    """Raise from an outbox subscriber to skip retries and send the delivery straight to the manual queue."""

    non_retryable = True
