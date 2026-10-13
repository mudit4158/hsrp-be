"""Port of src/utility/wallet/wallet.service.spec.ts."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select

from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.wallet.models import LedgerEntry
from app.utility.wallet.service import LedgerLine, WalletService, assert_balanced, available_paise, can_hold
from tests.conftest import as_system


def test_requires_balanced_journals():
    assert_balanced([LedgerLine("a", 100), LedgerLine("b", -100)])
    with pytest.raises(ValueError, match="balance"):
        assert_balanced([LedgerLine("a", 100), LedgerLine("b", -99)])
    with pytest.raises(ValueError):
        assert_balanced([LedgerLine("a", 0), LedgerLine("b", 0)])
    with pytest.raises(ValueError):
        assert_balanced([LedgerLine("a", 1.5), LedgerLine("b", -1.5)])  # type: ignore[arg-type]


def test_balance_may_go_negative_down_to_the_credit_limit():
    assert available_paise(-5_000, 10_000) == 5_000
    assert can_hold(1_000, 0, 1_000)
    assert not can_hold(1_000, 0, 1_001)
    assert can_hold(0, 2_000, 2_000)


@pytest.fixture
def wallets(clean):
    return WalletService(clean, AuditService(clean))


@pytest.fixture
def wallet_id(wallets):
    wid = as_system(lambda: wallets.open_wallet("group", "G1", "Shared wallet", 5_000)).id
    as_system(lambda: wallets.top_up(wid, 10_000, "TOPUP-1"))
    return wid


def test_top_up_credits_the_wallet(wallets, wallet_id):
    s = as_system(lambda: wallets.summary(wallet_id))
    assert (s["balancePaise"], s["heldPaise"], s["creditLimitPaise"], s["availablePaise"]) == (10_000, 0, 5_000, 15_000)


def test_hold_capture_release(wallets, wallet_id):
    h1 = as_system(lambda: wallets.hold(wallet_id, 3_000, "test.subject", "o1"))
    h2 = as_system(lambda: wallets.hold(wallet_id, 2_000, "test.subject", "o2"))
    s = as_system(lambda: wallets.summary(wallet_id))
    assert (s["balancePaise"], s["heldPaise"]) == (5_000, 5_000)
    as_system(lambda: wallets.capture(h1.id))
    as_system(lambda: wallets.release(h2.id))
    s = as_system(lambda: wallets.summary(wallet_id))
    assert (s["balancePaise"], s["heldPaise"]) == (7_000, 0)
    # capture is idempotent; a released hold cannot be captured
    assert as_system(lambda: wallets.capture(h1.id)).status == "CAPTURED"
    with pytest.raises(Problem):
        as_system(lambda: wallets.capture(h2.id))


def test_refunds_a_captured_hold(wallets, wallet_id):
    h = as_system(lambda: wallets.hold(wallet_id, 4_000, "test.subject", "o3"))
    as_system(lambda: wallets.capture(h.id))
    as_system(lambda: wallets.refund_captured(h.id))
    assert as_system(lambda: wallets.summary(wallet_id))["balancePaise"] == 10_000


def test_uses_the_credit_limit_and_refuses_beyond_it_with_402(wallets, wallet_id):
    as_system(lambda: wallets.hold(wallet_id, 14_000, "test.subject", "big"))
    assert as_system(lambda: wallets.summary(wallet_id))["balancePaise"] == -4_000
    with pytest.raises(Problem) as e:
        as_system(lambda: wallets.hold(wallet_id, 1_001, "test.subject", "too-much"))
    assert e.value.status == 402


def test_never_overspends_under_concurrent_holds(wallets, wallet_id):
    def attempt(i):
        try:
            as_system(lambda: wallets.hold(wallet_id, 4_000, "test.subject", f"c{i}"))
            return True
        except Problem:
            return False

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(attempt, range(6)))
    assert results.count(True) == 3  # 15 000 available → three 4 000 holds
    assert as_system(lambda: wallets.summary(wallet_id))["availablePaise"] == 3_000


def test_journals_balance_and_balances_equal_entry_sums(wallets, wallet_id, clean):
    h = as_system(lambda: wallets.hold(wallet_id, 1_000, "test.subject", "x"))
    as_system(lambda: wallets.capture(h.id))
    assert as_system(wallets.verify_integrity) == {"balanced": True, "mismatches": []}
    with clean.tx() as s:
        sums = s.execute(select(LedgerEntry.journal_id, func.sum(LedgerEntry.amount_paise)).group_by(LedgerEntry.journal_id)).all()
    assert all(total == 0 for _, total in sums)
