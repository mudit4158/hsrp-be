"""Double-entry wallet. A wallet is a WALLET account plus its own HOLDS account; FUNDING and REVENUE are system
accounts. Top-up: FUNDING→WALLET. Hold: WALLET→HOLDS. Capture: HOLDS→REVENUE. Release: HOLDS→WALLET. Refund after
capture: REVENUE→WALLET. Several owners can share one wallet (the caller decides the owner key)."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.wallet.models import LedgerAccount, LedgerEntry, LedgerHold, LedgerJournal

T = TypeVar("T")
SYSTEM_OWNER = {"owner_type": "system", "owner_id": "ledger"}


@dataclass(frozen=True)
class LedgerLine:
    account_id: str
    amount_paise: int


def assert_balanced(lines: list[LedgerLine]) -> None:
    """A journal must have at least two lines, whole non-zero paise, and sum to zero."""
    if len(lines) < 2:
        raise ValueError("A journal needs at least two lines")
    for line in lines:
        if not isinstance(line.amount_paise, int) or line.amount_paise == 0:
            raise ValueError("Line amounts must be non-zero whole paise")
    total = sum(line.amount_paise for line in lines)
    if total != 0:
        raise ValueError(f"Journal does not balance (off by {total} paise)")


def available_paise(balance_paise: int, credit_limit_paise: int) -> int:
    """Spendable amount: balance plus the credit limit (the balance may go negative down to -creditLimit)."""
    return balance_paise + credit_limit_paise


def can_hold(balance_paise: int, credit_limit_paise: int, amount_paise: int) -> bool:
    return amount_paise > 0 and available_paise(balance_paise, credit_limit_paise) >= amount_paise


def to_paise(rupees: float) -> int:
    # JavaScript Math.round (halves round up), not Python's banker's rounding.
    return math.floor(rupees * 100 + 0.5)


class WalletService:
    def __init__(self, db: Database, audit: AuditService):
        self.db = db
        self.audit = audit

    def _run(self, s: Session | None, fn: Callable[[Session], T]) -> T:
        if s is not None:
            return fn(s)
        with self.db.tx() as own:
            return fn(own)

    def open_wallet(self, owner_type: str, owner_id: str, name: str, credit_limit_paise: int = 0, s: Session | None = None) -> LedgerAccount:
        def run(tx: Session) -> LedgerAccount:
            tenant_id = request_context.tenant_id()
            now = utcnow()
            keys = ["tenant_id", "owner_type", "owner_id", "kind"]
            base = {"tenant_id": tenant_id, "owner_type": owner_type, "owner_id": owner_id, "currency": "INR", "balance_paise": 0, "created_at": now, "updated_at": now}
            wallet = tx.scalars(
                insert(LedgerAccount)
                .values(id=new_id(), kind="WALLET", name=name, credit_limit_paise=credit_limit_paise, **base)
                .on_conflict_do_update(index_elements=keys, set_={"name": name, "updated_at": now})
                .returning(LedgerAccount),
                execution_options={"populate_existing": True},
            ).one()
            tx.execute(
                insert(LedgerAccount)
                .values(id=new_id(), kind="HOLDS", name=f"{name} (holds)", credit_limit_paise=0, **base)
                .on_conflict_do_nothing(index_elements=keys)
            )
            self._system_account(tx, "FUNDING")
            self._system_account(tx, "REVENUE")
            return wallet

        return self._run(s, run)

    def summary(self, wallet_id: str, s: Session | None = None) -> dict[str, Any]:
        def run(tx: Session) -> dict[str, Any]:
            wallet = self._wallet(tx, wallet_id)
            holds = self._holds_account(tx, wallet)
            return {
                "id": wallet.id,
                "name": wallet.name,
                "ownerType": wallet.owner_type,
                "ownerId": wallet.owner_id,
                "balancePaise": wallet.balance_paise,
                "heldPaise": holds.balance_paise,
                "creditLimitPaise": wallet.credit_limit_paise,
                "availablePaise": available_paise(wallet.balance_paise, wallet.credit_limit_paise),
            }

        return self._run(s, run)

    def list(self) -> list[dict[str, Any]]:
        with self.db.tx() as s:
            ids = s.scalars(
                select(LedgerAccount.id).where(LedgerAccount.tenant_id == request_context.tenant_id(), LedgerAccount.kind == "WALLET").order_by(LedgerAccount.name)
            ).all()
            return [self.summary(i, s) for i in ids]

    def top_up(self, wallet_id: str, amount_paise: int, reference: str, s: Session | None = None) -> LedgerJournal:
        if not isinstance(amount_paise, int) or amount_paise <= 0:
            raise Problem.bad_request("Top-up amount must be positive")

        def run(tx: Session) -> LedgerJournal:
            wallet = self._wallet(tx, wallet_id)
            funding = self._system_account(tx, "FUNDING")
            j = self._post(
                tx,
                "TOPUP",
                f"Top-up {reference}",
                [LedgerLine(funding.id, -amount_paise), LedgerLine(wallet.id, amount_paise)],
                reference=reference,
                subject_type="wallet",
                subject_id=wallet.id,
            )
            self.audit.record("wallet.topup", "wallet", wallet.id, after={"amountPaise": amount_paise, "reference": reference}, s=tx)
            return j

        return self._run(s, run)

    def set_credit_limit(self, wallet_id: str, credit_limit_paise: int) -> LedgerAccount:
        with self.db.tx() as tx:
            wallet = self._wallet(tx, wallet_id)
            before = wallet.credit_limit_paise
            wallet.credit_limit_paise = credit_limit_paise
            tx.flush()
        self.audit.record("wallet.credit-limit", "wallet", wallet_id, before, credit_limit_paise)
        return wallet

    def hold(self, wallet_id: str, amount_paise: int, subject_type: str, subject_id: str, s: Session | None = None) -> LedgerHold:
        """Reserves funds for a subject. Fails with 402 if balance plus credit limit is not enough."""

        def run(tx: Session) -> LedgerHold:
            self._lock(tx, [wallet_id])
            wallet = self._wallet(tx, wallet_id)
            if not can_hold(wallet.balance_paise, wallet.credit_limit_paise, amount_paise):
                available = available_paise(wallet.balance_paise, wallet.credit_limit_paise) / 100
                raise Problem.payment_required(f"Wallet balance is not enough: available ₹{available:.2f}, needed ₹{amount_paise / 100:.2f}")
            holds = self._holds_account(tx, wallet)
            j = self._post(
                tx,
                "HOLD",
                f"Hold for {subject_type} {subject_id}",
                [LedgerLine(wallet.id, -amount_paise), LedgerLine(holds.id, amount_paise)],
                subject_type=subject_type,
                subject_id=subject_id,
            )
            h = LedgerHold(
                tenant_id=wallet.tenant_id,
                wallet_account_id=wallet.id,
                amount_paise=amount_paise,
                subject_type=subject_type,
                subject_id=subject_id,
                hold_journal_id=j.id,
            )
            tx.add(h)
            tx.flush()
            return h

        return self._run(s, run)

    def capture(self, hold_id: str, s: Session | None = None) -> LedgerHold:
        return self._settle(hold_id, "CAPTURE", s)

    def release(self, hold_id: str, s: Session | None = None) -> LedgerHold:
        return self._settle(hold_id, "RELEASE", s)

    def refund_captured(self, hold_id: str, s: Session | None = None) -> LedgerHold:
        """Gives back a captured amount (e.g. a cancelled order)."""

        def run(tx: Session) -> LedgerHold:
            hold = self._hold(tx, hold_id)
            if hold.status != "CAPTURED":
                raise Problem.conflict(f"Hold is {hold.status}, only CAPTURED can be refunded")
            wallet = self._wallet(tx, hold.wallet_account_id)
            revenue = self._system_account(tx, "REVENUE")
            j = self._post(
                tx,
                "REFUND",
                f"Refund for {hold.subject_type} {hold.subject_id}",
                [LedgerLine(revenue.id, -hold.amount_paise), LedgerLine(wallet.id, hold.amount_paise)],
                subject_type=hold.subject_type,
                subject_id=hold.subject_id,
            )
            hold.status, hold.settle_journal_id = "REFUNDED", j.id
            tx.flush()
            return hold

        return self._run(s, run)

    def statement(self, wallet_id: str, page: int = 1, page_size: int = 50) -> dict[str, Any]:
        with self.db.tx() as s:
            wallet = self._wallet(s, wallet_id)
            holds = self._holds_account(s, wallet)
            where = LedgerEntry.account_id.in_([wallet.id, holds.id])
            entries = s.scalars(select(LedgerEntry).where(where).order_by(LedgerEntry.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
            total = s.scalar(select(func.count()).select_from(LedgerEntry).where(where)) or 0
            journals = {j.id: j for j in s.scalars(select(LedgerJournal).where(LedgerJournal.id.in_([e.journal_id for e in entries])))}
        items = []
        for e in entries:
            j = journals.get(e.journal_id)
            items.append(
                {
                    **row(e),
                    "account": "WALLET" if e.account_id == wallet.id else "HOLDS",
                    "kind": j.kind if j else None,
                    "memo": j.memo if j else None,
                    "reference": j.reference if j else None,
                    "subjectType": j.subject_type if j else None,
                    "subjectId": j.subject_id if j else None,
                }
            )
        return {"items": items, "total": total, "page": page, "pageSize": page_size}

    def holds_for(self, wallet_id: str, status: str | None = None) -> list[LedgerHold]:
        q = select(LedgerHold).where(LedgerHold.wallet_account_id == wallet_id)
        if status:
            q = q.where(LedgerHold.status == status)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(LedgerHold.created_at.desc()).limit(200)))

    def get_hold(self, hold_id: str, s: Session | None = None) -> LedgerHold | None:
        with self.db.use(s) as session:
            return session.get(LedgerHold, hold_id)

    def verify_integrity(self) -> dict[str, Any]:
        """Recomputes every balance from entries and reports mismatches (used by tests and reconciliation)."""
        with self.db.tx() as s:
            sums = dict(s.execute(select(LedgerEntry.account_id, func.sum(LedgerEntry.amount_paise)).group_by(LedgerEntry.account_id)).all())
            accounts = s.scalars(select(LedgerAccount)).all()
        mismatches = [a.id for a in accounts if int(sums.get(a.id) or 0) != a.balance_paise]
        return {"balanced": sum(int(v or 0) for v in sums.values()) == 0, "mismatches": mismatches}

    # ------------------------------------------------------------------

    def _settle(self, hold_id: str, kind: str, s: Session | None) -> LedgerHold:
        def run(tx: Session) -> LedgerHold:
            hold = self._hold(tx, hold_id)
            if hold.status != "HELD":
                if (kind == "CAPTURE" and hold.status == "CAPTURED") or (kind == "RELEASE" and hold.status == "RELEASED"):
                    return hold
                raise Problem.conflict(f"Hold is already {hold.status}")
            wallet = self._wallet(tx, hold.wallet_account_id)
            holds = self._holds_account(tx, wallet)
            target = self._system_account(tx, "REVENUE") if kind == "CAPTURE" else wallet
            label = "Capture" if kind == "CAPTURE" else "Release"
            j = self._post(
                tx,
                kind,
                f"{label} for {hold.subject_type} {hold.subject_id}",
                [LedgerLine(holds.id, -hold.amount_paise), LedgerLine(target.id, hold.amount_paise)],
                subject_type=hold.subject_type,
                subject_id=hold.subject_id,
            )
            hold.status = "CAPTURED" if kind == "CAPTURE" else "RELEASED"
            hold.settle_journal_id = j.id
            tx.flush()
            return hold

        return self._run(s, run)

    def _post(
        self,
        tx: Session,
        kind: str,
        memo: str,
        lines: list[LedgerLine],
        reference: str | None = None,
        subject_type: str | None = None,
        subject_id: str | None = None,
    ) -> LedgerJournal:
        assert_balanced(lines)
        self._lock(tx, [line.account_id for line in lines])
        tenant_id = request_context.tenant_id()
        journal = LedgerJournal(
            tenant_id=tenant_id,
            kind=kind,
            memo=memo,
            reference=reference,
            subject_type=subject_type,
            subject_id=subject_id,
            created_by=request_context.actor_id(),
        )
        tx.add(journal)
        tx.flush()
        for line in lines:
            balance = tx.execute(
                update(LedgerAccount)
                .where(LedgerAccount.id == line.account_id)
                .values(balance_paise=LedgerAccount.balance_paise + line.amount_paise, updated_at=utcnow())
                .returning(LedgerAccount.balance_paise)
                .execution_options(synchronize_session=False)
            ).scalar_one()
            tx.add(LedgerEntry(tenant_id=tenant_id, journal_id=journal.id, account_id=line.account_id, amount_paise=line.amount_paise, balance_after_paise=balance))
        tx.flush()
        return journal

    def _lock(self, tx: Session, account_ids: list[str]) -> None:
        """Row locks in a fixed order so concurrent journals cannot deadlock or overspend."""
        ids = sorted(set(account_ids))
        tx.execute(text("SELECT id FROM util_wallet_account WHERE id = ANY(:ids) ORDER BY id FOR UPDATE"), {"ids": ids})

    def _wallet(self, tx: Session, id: str) -> LedgerAccount:
        # populate_existing: balances change through UPDATE statements, so never trust a cached row.
        w = tx.scalar(select(LedgerAccount).where(LedgerAccount.id == id, LedgerAccount.kind == "WALLET").execution_options(populate_existing=True))
        if w is None:
            raise Problem.not_found("Wallet")
        return w

    def _holds_account(self, tx: Session, wallet: LedgerAccount) -> LedgerAccount:
        h = tx.scalar(
            select(LedgerAccount)
            .where(
                LedgerAccount.tenant_id == wallet.tenant_id,
                LedgerAccount.owner_type == wallet.owner_type,
                LedgerAccount.owner_id == wallet.owner_id,
                LedgerAccount.kind == "HOLDS",
            )
            .execution_options(populate_existing=True)
        )
        if h is None:
            raise Problem(404, "Not found", "Record not found", "not-found")
        return h

    def _hold(self, tx: Session, hold_id: str) -> LedgerHold:
        h = tx.scalar(select(LedgerHold).where(LedgerHold.id == hold_id).execution_options(populate_existing=True))
        if h is None:
            raise Problem(404, "Not found", "Record not found", "not-found")
        return h

    def _system_account(self, tx: Session, kind: str) -> LedgerAccount:
        tenant_id = request_context.tenant_id()
        now = utcnow()
        tx.execute(
            insert(LedgerAccount)
            .values(
                id=new_id(),
                tenant_id=tenant_id,
                kind=kind,
                name="Funding (top-ups)" if kind == "FUNDING" else "Revenue",
                currency="INR",
                balance_paise=0,
                credit_limit_paise=0,
                created_at=now,
                updated_at=now,
                **SYSTEM_OWNER,
            )
            .on_conflict_do_nothing(index_elements=["tenant_id", "owner_type", "owner_id", "kind"])
        )
        return tx.scalars(
            select(LedgerAccount)
            .where(LedgerAccount.tenant_id == tenant_id, LedgerAccount.owner_type == "system", LedgerAccount.owner_id == "ledger", LedgerAccount.kind == kind)
            .execution_options(populate_existing=True)
        ).one()
