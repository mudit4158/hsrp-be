export interface PriceQuery {
  stateCode: string;
  vehicleClass: string;
  vehicleType?: string | null;
  oemCode?: string | null;
  orderType: string;
  plateSet: string;
  at: Date;
}

export interface PriceRuleLike {
  stateCode: string;
  vehicleClass: string;
  vehicleType: string | null;
  oemCode: string | null;
  orderType: string;
  plateSet: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Picks the most specific effective rule: OEM-specific beats generic, then type-specific beats any type. */
export function bestRule<T extends PriceRuleLike>(rules: T[], q: PriceQuery): T | undefined {
  const candidates = rules.filter(
    (r) =>
      r.stateCode === q.stateCode &&
      r.vehicleClass === q.vehicleClass &&
      r.orderType === q.orderType &&
      r.plateSet === q.plateSet &&
      r.effectiveFrom <= q.at &&
      (!r.effectiveTo || r.effectiveTo > q.at) &&
      (r.oemCode === null || r.oemCode === q.oemCode) &&
      (r.vehicleType === null || r.vehicleType === q.vehicleType),
  );
  const score = (r: T) => (r.oemCode ? 2 : 0) + (r.vehicleType ? 1 : 0);
  return candidates.sort((a, b) => score(b) - score(a) || b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}

/** An extra charge applies when every condition key equals the order's value. */
export function chargeApplies(conditions: Record<string, unknown>, facts: Record<string, unknown>) {
  return Object.entries(conditions).every(([k, v]) => (Array.isArray(v) ? v.includes(facts[k]) : facts[k] === v));
}
