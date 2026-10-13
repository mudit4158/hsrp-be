"""Where routers and jobs find the service container. The composition root (app/container.py) registers it at start,
so modules never import the container themselves (it imports every layer, which would break the dependency rules)."""

from typing import Any

_services: Any = None


def register(container: Any) -> None:
    global _services
    _services = container


def services() -> Any:
    if _services is None:
        raise RuntimeError("Service container not registered (app.container.container() registers it)")
    return _services
