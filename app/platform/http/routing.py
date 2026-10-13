"""Route class every router uses. FastAPI runs jsonable_encoder on a returned value before the response class sees it
(ISO datetimes without 'Z', ORM objects unreadable), so convert results with to_jsonable first."""

import functools
import inspect
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter
from fastapi.routing import APIRoute
from starlette.responses import Response

from app.platform.http.json import to_jsonable


def _encode(result: Any) -> Any:
    return result if isinstance(result, Response) else to_jsonable(result)


def _wrap(endpoint: Callable[..., Any]) -> Callable[..., Any]:
    # functools.wraps keeps __wrapped__, so FastAPI still reads the endpoint's own signature for its dependencies.
    if inspect.iscoroutinefunction(endpoint):

        @functools.wraps(endpoint)
        async def run_async(*args: Any, **kwargs: Any) -> Any:
            return _encode(await endpoint(*args, **kwargs))

        return run_async

    @functools.wraps(endpoint)
    def run(*args: Any, **kwargs: Any) -> Any:
        return _encode(endpoint(*args, **kwargs))

    return run


class ApiRoute(APIRoute):
    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        super().__init__(path, _wrap(endpoint), **kwargs)


def router(prefix: str = "", tags: list[str] | None = None) -> APIRouter:
    return APIRouter(prefix=prefix, tags=tags or [], route_class=ApiRoute)
