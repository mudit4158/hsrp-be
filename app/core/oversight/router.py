from app.platform.http.decorators import require
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("", ["oversight"])


@router.get("/dashboard")
@require("orders.read")
def dashboard():
    return services().oversight.dashboard()


@router.get("/orders/{id}/detail")
@require("orders.read")
def detail(id: str):
    return services().oversight.order_detail(id)


@router.get("/dealer/home")
@require("dealer.app")
def home():
    return services().oversight.dealer_home()


@router.get("/dealer/wallet")
@require("dealer.app")
def wallet():
    return services().oversight.dealer_wallet()


@router.get("/admin/jobs")
@require("integration.monitor")
def jobs():
    return services().scheduler.job_names()


@router.post("/admin/jobs/{name}/run")
@require("integration.replay")
def run(name: str):
    return services().scheduler.run_now(name)
