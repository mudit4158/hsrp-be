"""Deterministic generator for the mock VAHAN table. Every record is fictional. The random generator is mulberry32,
bit for bit as the NestJS seed ran it, so both seeds produce the same vehicles."""

from typing import Any, TypeVar

T = TypeVar("T")
M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


class Rng:
    def __init__(self, seed: int):
        self.a = seed & M32

    def next(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & M32
        t = self.a
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    def int(self, lo: int, hi: int) -> int:
        """Inclusive of both ends."""
        return lo + int(self.next() * (hi - lo + 1))

    def pick(self, items: list[T] | tuple[T, ...] | str) -> Any:
        return items[int(self.next() * len(items))]

    def weighted(self, items: list[tuple[T, float]]) -> T:
        total = sum(w for _, w in items)
        r = self.next() * total
        for v, w in items:
            r -= w
            if r <= 0:
                return v
        return items[-1][0]


POOLS = [
    ("seed-new", 72),
    ("seed-old", 22),
    ("seed-repl", 8),
    ("demo-new", 26),
    ("oem-zenmo-sample", 12),
    ("oem-kranti-sample", 20),
    ("demo-old", 12),
    ("demo-has-plates", 8),
    ("garbled-post", 2),
    ("bad-category", 1),
]

# Pools of vehicles registered after the new-vehicle cut-off.
NEW_POOLS = ("seed-new", "demo-new", "oem-zenmo-sample", "oem-kranti-sample", "garbled-post", "bad-category")

ALNUM = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
OTHER_MAKERS = ["DEMO MOTORS (FICTIONAL)", "SAMPLE CYCLES (FICTIONAL)", "TEST TRUCKS (FICTIONAL)"]


def generate_vehicles() -> list[dict[str, Any]]:
    r = Rng(20261010)
    out: list[dict[str, Any]] = []
    used: set[str] = set()

    def s(n: int) -> str:
        return "".join(r.pick(ALNUM) for _ in range(n))

    def dmy(y: int, m: int, d: int) -> str:
        return f"{d:02d}-{m:02d}-{y}"

    for state in ("WB", "OD"):
        for pool, count in POOLS:
            for _ in range(count):
                is_new = pool in NEW_POOLS
                office = r.int(1, 30)
                while True:
                    regn_no = (
                        f"{state}{office:02d}{r.pick(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'])}"
                        f"{r.pick(['A', 'B', 'C', 'D', 'E', 'M', 'N', 'P', 'R', 'S'])}{r.int(1, 9999):04d}"
                    )
                    if regn_no not in used:
                        break
                used.add(regn_no)
                catg = r.weighted([("2WN", 45), ("LMV", 30), ("3WT", 9), ("LPV", 6), ("HGV", 7), ("TRL", 3)])
                if pool == "bad-category":
                    catg = "XYZ"
                if pool in ("oem-zenmo-sample", "oem-kranti-sample"):
                    catg = r.pick(["2WN", "LMV", "LMV"])
                if pool == "oem-zenmo-sample":
                    maker = "ZENMO MOTORS (FICTIONAL)"
                elif pool == "oem-kranti-sample":
                    maker = "KRANTI AUTOS (FICTIONAL)"
                else:
                    maker = r.weighted([("ZENMO MOTORS (FICTIONAL)", 35), ("KRANTI AUTOS (FICTIONAL)", 35), (r.pick(OTHER_MAKERS), 30)])
                fuel = r.weighted([("PETROL", 80), ("ELECTRIC", 20)]) if catg == "2WN" else r.weighted([("PETROL", 45), ("DIESEL", 30), ("CNG", 15), ("ELECTRIC", 10)])
                regn_date = dmy(r.int(2020, 2026), r.int(1, 9), r.int(1, 28)) if is_new else dmy(r.int(2006, 2018), r.int(1, 12), r.int(1, 28))
                norms = ("BHARAT STAGE VI" if r.next() < 0.9 else "BHARAT STAGE IV") if is_new else r.pick(["BHARAT STAGE IV", "BHARAT STAGE III", "BHARAT STAGE II"])
                has_plates = pool in ("seed-repl", "demo-has-plates")
                out.append(
                    {
                        "regn_no": regn_no,
                        "chassis_no": f"M{r.pick(['A', 'B', 'C', 'D'])}{s(10)}{r.int(10000, 99999)}",
                        "engine_no": f"{r.pick(['E', 'K', 'G'])}{s(4)}{r.int(10000, 99999)}",
                        "state_cd": state,
                        "off_cd": f"{state}{office:02d}",
                        "maker": maker,
                        "fuel": fuel,
                        "vch_type": "TRANSPORT" if catg in ("LPV", "3WT", "HGV", "TRL", "2WT") else "NON TRANSPORT",
                        "vch_catg": catg,
                        "norms": norms,
                        "regn_date": regn_date,
                        "hsrp_front_laser_code": f"ZZ{r.int(1_000_000_000, 9_999_999_999)}" if has_plates else None,
                        "hsrp_rear_laser_code": f"ZZ{r.int(1_000_000_000, 9_999_999_999)}" if has_plates else None,
                        "scenario": pool,
                    }
                )
    return out
