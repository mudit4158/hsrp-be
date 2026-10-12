export interface LedgerLine {
  accountId: string;
  amountPaise: number;
}

/** A journal must have at least two lines, integer amounts, and sum to zero. */
export function assertBalanced(lines: LedgerLine[]) {
  if (lines.length < 2) throw new Error('A journal needs at least two lines');
  for (const l of lines) {
    if (!Number.isInteger(l.amountPaise) || l.amountPaise === 0) throw new Error('Line amounts must be non-zero whole paise');
  }
  const sum = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (sum !== 0) throw new Error(`Journal does not balance (off by ${sum} paise)`);
}

/** Spendable amount: balance plus the credit limit (the balance may go negative down to -creditLimit). */
export function availablePaise(balancePaise: number, creditLimitPaise: number) {
  return balancePaise + creditLimitPaise;
}

export function canHold(balancePaise: number, creditLimitPaise: number, amountPaise: number) {
  return amountPaise > 0 && availablePaise(balancePaise, creditLimitPaise) >= amountPaise;
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;
