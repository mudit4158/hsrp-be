"""Organisations, users, roles and sessions. Knows nothing about what an organisation *is* in the business."""

import time
from typing import Any

import jwt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.platform.config import env, jwt_ttl_seconds
from app.platform.context import Actor, request_context
from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.identity.devices import DeviceService
from app.utility.identity.models import IamOrg, IamRole, IamUser
from app.utility.identity.passwords import hash_password, verify_password

_UNSET: Any = object()


def sign_token(claims: dict[str, Any], expires_in: str | None = None) -> str:
    """HS256 JWT with iat and exp, as jsonwebtoken signs it (same secret, so tokens work on either backend)."""
    now = int(time.time())
    return jwt.encode({**claims, "iat": now, "exp": now + jwt_ttl_seconds(expires_in or env.jwt_expires_in)}, env.jwt_secret, algorithm="HS256")


def _public_user(u: IamUser, perms: list[str]) -> dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username,
        "displayName": u.display_name,
        "roles": u.roles,
        "orgId": u.org_id,
        "mobile": u.mobile,
        "email": u.email,
        "permissions": perms,
    }


class IdentityService:
    def __init__(self, db: Database, devices: DeviceService, audit: AuditService):
        self.db = db
        self.devices = devices
        self.audit = audit

    def login(self, username: str, password: str, device_id: str | None = None, device_name: str | None = None) -> dict[str, Any]:
        tenant_id = request_context.tenant_id()
        with self.db.tx() as s:
            user = s.scalar(select(IamUser).where(IamUser.tenant_id == tenant_id, IamUser.username == username.strip().lower()))
        ok = user is not None and user.active and verify_password(password, user.password_hash)
        if not ok:
            self.audit.record("auth.login.failed", "user", user.id if user else None, after={"username": username}, actor_type="anonymous")
            raise Problem.unauthorized("Wrong username or password")
        assert user is not None
        if device_id:
            self.devices.register(tenant_id, user.id, device_id, device_name)
        perms = self.permissions_for(tenant_id, user.roles or [])
        claims: dict[str, Any] = {
            "sub": user.id,
            "tid": tenant_id,
            "kind": "user",
            "name": user.display_name,
            "roles": user.roles,
            "perms": perms,
            "org": user.org_id,
        }
        if device_id:
            claims["dev"] = device_id
        token = sign_token(claims)
        with self.db.tx() as s:
            s.get_one(IamUser, user.id).last_login_at = utcnow()
        request_context.set(actor=Actor(id=user.id, type="user", name=user.display_name, roles=user.roles or [], permissions=perms, org_id=user.org_id))
        self.audit.record("auth.login", "user", user.id)
        return {"token": token, "expiresIn": env.jwt_expires_in, "user": _public_user(user, perms)}

    def me(self) -> dict[str, Any]:
        actor = request_context.actor()
        if actor is None:
            raise Problem.unauthorized()
        if actor.type != "user":
            return {"id": actor.id, "displayName": actor.name, "roles": actor.roles, "permissions": actor.permissions, "claims": actor.claims}
        with self.db.tx() as s:
            user = s.get(IamUser, actor.id)
            if user is None:
                raise Problem(404, "Not found", "Record not found", "not-found")
            org = s.get(IamOrg, user.org_id) if user.org_id else None
        return {**_public_user(user, actor.permissions), "org": row(org)}

    def permissions_for(self, tenant_id: str, roles: list[str]) -> list[str]:
        with self.db.tx() as s:
            rows = s.scalars(select(IamRole).where(IamRole.tenant_id == tenant_id, IamRole.code.in_(roles))).all()
        return list(dict.fromkeys(p for r in rows for p in (r.permissions or [])))

    def create_user(
        self,
        username: str,
        display_name: str,
        password: str,
        roles: list[str],
        org_id: str | None = None,
        mobile: str | None = None,
        email: str | None = None,
    ) -> dict[str, Any]:
        with self.db.tx() as s:
            user = IamUser(
                tenant_id=request_context.tenant_id(),
                username=username.strip().lower(),
                display_name=display_name,
                password_hash=hash_password(password),
                roles=roles,
                org_id=org_id,
                mobile=mobile,
                email=email,
            )
            s.add(user)
            s.flush()
        self.audit.record("user.create", "user", user.id, after={"username": user.username, "roles": user.roles})
        return _public_user(user, [])

    def update_user(
        self,
        id: str,
        display_name: str | None = None,
        roles: list[str] | None = None,
        active: bool | None = None,
        password: str | None = None,
        org_id: Any = _UNSET,
    ) -> dict[str, Any]:
        with self.db.tx() as s:
            user = s.scalar(select(IamUser).where(IamUser.id == id, IamUser.tenant_id == request_context.tenant_id()))
            if user is None:
                raise Problem.not_found("User")
            before = {"roles": list(user.roles or []), "active": user.active, "displayName": user.display_name}
            if display_name is not None:
                user.display_name = display_name
            if roles is not None:
                user.roles = roles
            if active is not None:
                user.active = active
            if org_id is not _UNSET:
                user.org_id = org_id
            if password:
                user.password_hash = hash_password(password)
            s.flush()
        self.audit.record(
            "user.update",
            "user",
            id,
            before,
            {"roles": user.roles, "active": user.active, "displayName": user.display_name, "passwordChanged": bool(password)},
        )
        return _public_user(user, [])

    def list_users(self) -> list[dict[str, Any]]:
        with self.db.tx() as s:
            users = s.scalars(select(IamUser).where(IamUser.tenant_id == request_context.tenant_id()).order_by(IamUser.username)).all()
        return [
            {
                "id": u.id,
                "username": u.username,
                "displayName": u.display_name,
                "roles": u.roles,
                "orgId": u.org_id,
                "active": u.active,
                "mobile": u.mobile,
                "email": u.email,
                "lastLoginAt": u.last_login_at,
            }
            for u in users
        ]

    def list_roles(self) -> list[IamRole]:
        with self.db.tx() as s:
            return list(s.scalars(select(IamRole).where(IamRole.tenant_id == request_context.tenant_id()).order_by(IamRole.code)))

    def update_role(self, code: str, permissions: list[str]) -> IamRole:
        with self.db.tx() as s:
            role = s.scalar(select(IamRole).where(IamRole.tenant_id == request_context.tenant_id(), IamRole.code == code))
            if role is None:
                raise Problem.not_found("Role")
            before = list(role.permissions or [])
            role.permissions = permissions
            s.flush()
        self.audit.record("role.update", "role", code, before, permissions)
        return role

    def list_orgs(self, org_type: str | None = None) -> list[IamOrg]:
        q = select(IamOrg).where(IamOrg.tenant_id == request_context.tenant_id())
        if org_type:
            q = q.where(IamOrg.org_type == org_type)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(IamOrg.code)))

    def upsert_org(self, code: str, name: str, org_type: str, parent_id: str | None = None, external_ref: str | None = None, s=None) -> IamOrg:
        """Creates or updates an organisation node in the hierarchy."""
        now = utcnow()
        values = {"name": name, "org_type": org_type, "parent_id": parent_id, "external_ref": external_ref, "updated_at": now}
        stmt = (
            insert(IamOrg)
            .values(id=new_id(), tenant_id=request_context.tenant_id(), code=code, active=True, created_at=now, **values)
            .on_conflict_do_update(index_elements=["tenant_id", "code"], set_=values)
            .returning(IamOrg)
        )
        with self.db.use(s) as session:
            return session.scalars(stmt).one()
