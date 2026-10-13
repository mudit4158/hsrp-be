import hashlib


def _sha512(s: str) -> str:
    return hashlib.sha512(s.encode()).hexdigest()


def request_hash(f: dict[str, str], salt: str) -> str:
    """PayU request hash: sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT)."""
    udf = [f.get(f"udf{i}", "") for i in range(1, 6)]
    return _sha512("|".join([f.get("key", ""), f.get("txnid", ""), f.get("amount", ""), f.get("productinfo", ""), f.get("firstname", ""), f.get("email", ""), *udf, "", "", "", "", "", salt]))


def response_hash(f: dict[str, str], salt: str) -> str:
    """PayU response (reverse) hash: sha512(SALT|status||||||udf5..udf1|email|firstname|productinfo|amount|txnid|key)."""
    udf = [f.get(f"udf{i}", "") for i in range(5, 0, -1)]
    parts = [salt, f.get("status", ""), "", "", "", "", "", *udf, f.get("email", ""), f.get("firstname", ""), f.get("productinfo", ""), f.get("amount", ""), f.get("txnid", ""), f.get("key", "")]
    return _sha512("|".join(parts))


def rupees(paise: int) -> str:
    return f"{paise / 100:.2f}"


def paise(amount: str) -> int:
    return int(float(amount) * 100 + 0.5)
