"""OEM systems call the API with an API key plus an HMAC-SHA256 signature of the raw request body."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from base64 import urlsafe_b64encode

from sqlalchemy import select

from app.platform.context import Actor
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.identity.models import IamApiClient, IamRole


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def sign_body(secret: str, raw_body: bytes | str) -> str:
    """HMAC-SHA256 of the raw request body with the client's shared secret, hex encoded."""
    data = raw_body.encode() if isinstance(raw_body, str) else raw_body
    return hmac.new(secret.encode(), data, hashlib.sha256).hexdigest()


def _token(n: int) -> str:
    # Node's randomBytes(n).toString('base64url'): URL-safe base64 without padding.
    return urlsafe_b64encode(secrets.token_bytes(n)).rstrip(b"=").decode()


class ApiClientService:
    def __init__(self, db: Database):
        self.db = db

    def authenticate(self, api_key: str | None, signature: str | None, raw_body: bytes) -> tuple[str, Actor]:
        if not api_key:
            raise Problem.unauthorized("X-Api-Key header required")
        with self.db.tx() as s:
            client = s.scalar(select(IamApiClient).where(IamApiClient.key_hash == hash_key(api_key)))
            if client is None or not client.active:
                raise Problem.unauthorized("Unknown or inactive API key")
            if not signature:
                raise Problem.unauthorized("X-Signature header required")
            expected = sign_body(client.secret, raw_body)
            try:
                given = bytes.fromhex(signature).hex()
            except ValueError:
                given = ""
            if not hmac.compare_digest(expected, given):
                raise Problem.unauthorized("Request signature does not match")
            roles = s.scalars(select(IamRole).where(IamRole.tenant_id == client.tenant_id, IamRole.code.in_(client.roles or []))).all()
        permissions = list(dict.fromkeys(p for r in roles for p in (r.permissions or [])))
        actor = Actor(id=client.id, type="api-client", name=client.name, roles=list(client.roles or []), permissions=permissions, org_id=client.org_id)
        return client.tenant_id, actor

    def create(self, tenant_id: str, org_id: str, name: str, roles: list[str], api_key: str | None = None, secret: str | None = None) -> dict[str, str]:
        """Creates a client and returns the API key and secret once; only a hash of the key is stored."""
        api_key = api_key or f"hk_{_token(18)}"
        secret = secret or _token(24)
        with self.db.tx() as s:
            client = IamApiClient(tenant_id=tenant_id, org_id=org_id, name=name, roles=roles, key_hash=hash_key(api_key), secret=secret)
            s.add(client)
            s.flush()
            return {"id": client.id, "apiKey": api_key, "secret": secret}

    def list(self, tenant_id: str) -> list[dict]:
        with self.db.tx() as s:
            rows = s.scalars(select(IamApiClient).where(IamApiClient.tenant_id == tenant_id)).all()
        return [{"id": c.id, "name": c.name, "orgId": c.org_id, "roles": c.roles, "active": c.active, "createdAt": c.created_at} for c in rows]
