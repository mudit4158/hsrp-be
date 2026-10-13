from typing import Annotated

from pydantic import Field, StringConstraints

from app.contracts.schemas import Email, LoginRequest
from app.platform.context import request_context
from app.platform.http.decorators import public, require, throttle
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("", ["identity"])


class CreateUserBody(ApiModel):
    username: Annotated[str, StringConstraints(min_length=3, max_length=60)]
    display_name: Annotated[str, StringConstraints(min_length=2, max_length=100)]
    password: Annotated[str, StringConstraints(min_length=8, max_length=100)]
    roles: list[str] = Field(min_length=1)
    org_id: str | None = None
    mobile: str | None = None
    email: Email | None = None


class UpdateUserBody(ApiModel):
    display_name: Annotated[str, StringConstraints(min_length=2, max_length=100)] | None = None
    roles: list[str] | None = Field(None, min_length=1)
    active: bool | None = None
    password: Annotated[str, StringConstraints(min_length=8, max_length=100)] | None = None
    org_id: str | None = None


class RolePermsBody(ApiModel):
    permissions: list[str]


class DeviceActiveBody(ApiModel):
    active: bool


class ApiClientBody(ApiModel):
    org_id: str
    name: Annotated[str, StringConstraints(min_length=2)]
    roles: list[str] = Field(min_length=1)


@router.post("/auth/login")
@public
@throttle(20, 60)
def login(body: LoginRequest):
    return services().identity.login(body.username, body.password, body.device_id, body.device_name)


@router.get("/auth/me")
def me():
    return services().identity.me()


@router.get("/iam/users")
@require("iam.manage")
def users():
    return services().identity.list_users()


@router.post("/iam/users")
@require("iam.manage")
def create_user(body: CreateUserBody):
    return services().identity.create_user(body.username, body.display_name, body.password, body.roles, body.org_id, body.mobile, body.email)


@router.patch("/iam/users/{id}")
@require("iam.manage")
def update_user(id: str, body: UpdateUserBody):
    patch = body.model_dump(exclude_unset=True, include={"display_name", "roles", "active", "password", "org_id"})
    return services().identity.update_user(id, **patch)


@router.get("/iam/roles")
@require("iam.manage")
def roles():
    return services().identity.list_roles()


@router.patch("/iam/roles/{code}")
@require("iam.manage")
def update_role(code: str, body: RolePermsBody):
    return services().identity.update_role(code, body.permissions)


@router.get("/iam/orgs")
@require("iam.manage", "masters.read")
def orgs(orgType: str | None = None):  # noqa: N803 (query parameter name on the wire)
    return services().identity.list_orgs(orgType)


@router.get("/iam/devices")
@require("iam.manage")
def devices(userId: str | None = None):  # noqa: N803
    return services().devices.list(request_context.tenant_id(), userId)


@router.patch("/iam/devices/{id}")
@require("iam.manage")
def set_device(id: str, body: DeviceActiveBody):
    return services().devices.set_active(request_context.tenant_id(), id, body.active)


@router.get("/iam/api-clients")
@require("iam.manage")
def clients():
    return services().api_clients.list(request_context.tenant_id())


@router.post("/iam/api-clients")
@require("iam.manage")
def create_client(body: ApiClientBody):
    return services().api_clients.create(request_context.tenant_id(), body.org_id, body.name, body.roles)
