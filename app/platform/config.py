"""Environment settings, read from the process environment (Docker) or the repo-root .env (local runs)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    # Outside Docker, read the repo-root .env (Docker passes variables directly). Variables already set win.
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()


def _get(name: str) -> str | None:
    return os.environ.get(name)


def _str(name: str, fallback: str | None = None) -> str:
    v = _get(name)
    if v is None or v == "":
        if fallback is None:
            raise RuntimeError(f"Missing environment variable {name}")
        return fallback
    return v


def _bool(name: str, fallback: bool) -> bool:
    return (_get(name) or str(fallback)).lower() == "true"


def _int(name: str, fallback: int) -> int:
    return int(_get(name) or fallback)


@dataclass(frozen=True)
class Adapters:
    vahan: str = field(default_factory=lambda: _str("VAHAN_ADAPTER", "mock"))
    payment: str = field(default_factory=lambda: _str("PAYMENT_ADAPTER", "mock"))
    message: str = field(default_factory=lambda: _str("MESSAGE_ADAPTER", "mock"))
    oem: str = field(default_factory=lambda: _str("OEM_ADAPTER", "mock"))
    file_store: str = field(default_factory=lambda: _str("FILE_STORE_ADAPTER", "db"))
    # Plate OCR: tesseract (real, needs the tesseract binary) or mock (reads the text test images embed).
    ocr: str = field(default_factory=lambda: _str("OCR_ADAPTER", "tesseract"))


@dataclass(frozen=True)
class Env:
    port: int = field(default_factory=lambda: _int("API_PORT", 3000))
    host: str = field(default_factory=lambda: _str("API_HOST", "0.0.0.0"))
    public_api_url: str = field(default_factory=lambda: _str("PUBLIC_API_URL", "http://localhost:3000"))
    public_web_url: str = field(default_factory=lambda: _str("PUBLIC_WEB_URL", "http://localhost:8080"))
    internal_api_url: str = field(default_factory=lambda: _str("INTERNAL_API_URL", f"http://localhost:{_int('API_PORT', 3000)}"))
    jwt_secret: str = field(default_factory=lambda: _str("JWT_SECRET", "dev-only-secret-change-me-dev-only-secret"))
    jwt_expires_in: str = field(default_factory=lambda: _str("JWT_EXPIRES_IN", "8h"))
    file_link_secret: str = field(default_factory=lambda: _str("FILE_LINK_SECRET", "dev-only-file-secret"))
    worker_enabled: bool = field(default_factory=lambda: _bool("WORKER_ENABLED", True))
    outbox_retry_base_ms: int = field(default_factory=lambda: _int("OUTBOX_RETRY_BASE_MS", 5000))
    demo_mode: bool = field(default_factory=lambda: _bool("DEMO_MODE", False))
    demo_fixed_otp: str = field(default_factory=lambda: _str("DEMO_FIXED_OTP", "123456"))
    default_tenant_id: str = field(default_factory=lambda: _str("DEFAULT_TENANT_ID", "t-demo"))
    adapters: Adapters = field(default_factory=Adapters)
    payu_key: str = field(default_factory=lambda: _str("PAYU_MERCHANT_KEY", "MOCKKEY"))
    payu_salt: str = field(default_factory=lambda: _str("PAYU_MERCHANT_SALT", "mock-salt-not-secret"))

    @property
    def database_url(self) -> str:
        # Read on each use: the tests point DATABASE_URL at their own database after import.
        return _str("DATABASE_URL")


env = Env()


def jwt_ttl_seconds(spec: str) -> int:
    """'8h', '30m', '45s', '2d' or seconds, as jsonwebtoken's expiresIn."""
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    spec = spec.strip()
    if spec[-1:] in units:
        return int(float(spec[:-1]) * units[spec[-1]])
    return int(spec)
