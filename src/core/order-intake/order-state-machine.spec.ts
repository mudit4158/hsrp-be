import { ORDER_STATUSES, OrderStatus } from '@hsrp/contracts';
import { assertTransition, CANCELLABLE, canTransition, FINAL_STATUSES, positionsOf, routeAfterApproval, routeAfterValidation, TRANSITIONS, TransitionError } from './order-state-machine';

describe('order state machine', () => {
  it('defines transitions for every status', () => {
    for (const s of ORDER_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });

  it('follows the main path from RECEIVED to COMPLETED', () => {
    const path: OrderStatus[] = ['RECEIVED', 'VALIDATED', 'CONFIRMED', 'ISSUED', 'QC_PASSED', 'STICKER_PRINTED', 'DISPATCHED', 'INWARDED', 'FITTED', 'COMPLETED'];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
  });

  it('routes validation failure to REJECTED', () => {
    expect(canTransition('RECEIVED', 'REJECTED')).toBe(true);
  });

  it('only confirms a customer order through payment', () => {
    expect(routeAfterValidation({ orderType: 'OLD', channel: 'CUSTOMER_PORTAL' })).toBe('AWAITING_PAYMENT');
    expect(canTransition('AWAITING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransition('AWAITING_PAYMENT', 'REJECTED')).toBe(false);
  });

  it('sends replacement orders to approval first, then payment for customers or confirmation for dealers', () => {
    expect(routeAfterValidation({ orderType: 'REPLACEMENT', channel: 'DEALER_APP' })).toBe('AWAITING_APPROVAL');
    expect(routeAfterValidation({ orderType: 'REPLACEMENT', channel: 'CUSTOMER_PORTAL' })).toBe('AWAITING_APPROVAL');
    expect(routeAfterApproval({ channel: 'CUSTOMER_PORTAL' })).toBe('AWAITING_PAYMENT');
    expect(routeAfterApproval({ channel: 'OEM_API' })).toBe('CONFIRMED');
    expect(canTransition('AWAITING_APPROVAL', 'REJECTED')).toBe(true);
  });

  it('confirms dealer and OEM orders straight after validation (wallet captured)', () => {
    for (const channel of ['DEALER_APP', 'STAFF_WEB', 'OEM_API', 'OEM_FILE']) expect(routeAfterValidation({ orderType: 'NEW', channel })).toBe('CONFIRMED');
  });

  it('allows cancel only before ISSUED', () => {
    for (const s of ORDER_STATUSES) {
      expect(canTransition(s, 'CANCELLED')).toBe(CANCELLABLE.includes(s));
    }
    expect(CANCELLABLE).not.toContain('ISSUED');
  });

  it('sends QC and dealer rejections to review, and review back to the right stage', () => {
    expect(canTransition('ISSUED', 'REJECTION_REVIEW')).toBe(true);
    expect(canTransition('DISPATCHED', 'REJECTION_REVIEW')).toBe(true);
    expect(canTransition('REJECTION_REVIEW', 'CONFIRMED')).toBe(true); // approved: re-issue
    expect(canTransition('REJECTION_REVIEW', 'QC_PASSED')).toBe(true); // disapproved after QC
    expect(canTransition('REJECTION_REVIEW', 'INWARDED')).toBe(true); // disapproved after dealer inward
    expect(canTransition('REJECTION_REVIEW', 'DISPATCHED')).toBe(false);
  });

  it('keeps an order FITTED until VAHAN accepts the post', () => {
    expect(TRANSITIONS.FITTED).toEqual(['COMPLETED']);
  });

  it('never leaves a final status', () => {
    for (const s of FINAL_STATUSES) expect(TRANSITIONS[s]).toHaveLength(0);
  });

  it('rejects skipping stages', () => {
    expect(() => assertTransition('CONFIRMED', 'DISPATCHED')).toThrow(TransitionError);
    expect(() => assertTransition('RECEIVED', 'CONFIRMED')).toThrow(TransitionError);
    expect(() => assertTransition('INWARDED', 'COMPLETED')).toThrow(TransitionError);
  });

  it('expands plate sets into positions', () => {
    expect(positionsOf('BOTH')).toEqual(['FRONT', 'REAR']);
    expect(positionsOf('REAR')).toEqual(['REAR']);
  });
});
