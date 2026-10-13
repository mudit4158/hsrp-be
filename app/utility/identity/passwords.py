"""scrypt hashes in the form `scrypt$<salt b64>$<hash b64>`, with Node's scrypt defaults (N=16384, r=8, p=1), so
hashes written by the NestJS backend keep working."""

import base64
import hashlib
import hmac
import os


def _scrypt(password: str, salt: bytes, length: int) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=length, maxmem=64 * 1024 * 1024)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(_scrypt(password, salt, 32)).decode()}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) != 3 or parts[0] != "scrypt" or not parts[1] or not parts[2]:
        return False
    expected = base64.b64decode(parts[2])
    actual = _scrypt(password, base64.b64decode(parts[1]), len(expected))
    return hmac.compare_digest(expected, actual)
