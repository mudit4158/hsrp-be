// Utility tests: pure functions of the generic modules. No core module is loaded.
import { mapRow, parseCsv, toCsv } from './import-export/csv';
import { renderTemplate } from './notification/notification.service';
import { slotStarts, weekdayOf } from './scheduling/scheduling.service';
import { ageing } from './tickets/tickets.service';
import { fill } from './documents/pdf-renderer';
import { formatNumber } from './documents/documents.service';

describe('import mapping', () => {
  const profile = {
    columns: {
      ref: { from: 'Invoice No', required: true },
      regnNo: { from: 'Reg', required: true, transform: 'upper' as const },
      mobile: { from: 'Mobile', transform: 'digits' as const },
      date: { from: 'Date', transform: 'date-dmy' as const },
    },
  };
  it('maps and transforms a row', () => {
    expect(mapRow({ 'Invoice No': 'INV-1', Reg: ' wb02ab1234 ', Mobile: '+91 90000-12345', Date: '5/7/2024' }, profile)).toEqual({
      mapped: { ref: 'INV-1', regnNo: 'WB02AB1234', mobile: '919000012345', date: '2024-07-05' },
      errors: [],
    });
  });
  it('reports missing required columns per row', () => {
    expect(mapRow({ 'Invoice No': '', Reg: 'X' }, profile).errors).toEqual(['Invoice No is required']);
  });
  it('round-trips CSV with quoting', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"' }]);
    expect(parseCsv(csv)).toEqual([{ a: 'x,y', b: 'say "hi"' }]);
  });
});

describe('notification templates', () => {
  it('fills variables and refuses missing ones (wording is fixed by the template)', () => {
    expect(renderTemplate('{{otp}} is your code', { otp: '123456' })).toBe('123456 is your code');
    expect(() => renderTemplate('{{otp}} for {{orderNo}}', { otp: '1' })).toThrow(/orderNo/);
  });
});

describe('scheduling', () => {
  it('cuts a calendar rule into slots', () => {
    expect(slotStarts({ startTime: '10:00', endTime: '13:00', slotMinutes: 60 })).toEqual(['10:00', '11:00', '12:00']);
    expect(slotStarts({ startTime: '10:00', endTime: '10:45', slotMinutes: 30 })).toEqual(['10:00']);
  });
  it('knows the weekday of a date', () => {
    expect(weekdayOf('2026-10-11')).toBe(0); // Sunday
  });
});

describe('ticket ageing', () => {
  const created = new Date('2026-09-01T00:00:00Z');
  const due = new Date('2026-09-16T00:00:00Z');
  it('flags open tickets past the time limit', () => {
    expect(ageing({ createdAt: created, dueAt: due, status: 'OPEN' }, new Date('2026-09-20T00:00:00Z'))).toMatchObject({ ageDays: 19, overdue: true, daysLeft: -4 });
    expect(ageing({ createdAt: created, dueAt: due, status: 'OPEN' }, new Date('2026-09-10T00:00:00Z'))).toMatchObject({ ageDays: 9, overdue: false, daysLeft: 6 });
  });
  it('measures resolved tickets at resolution', () => {
    expect(ageing({ createdAt: created, dueAt: due, status: 'RESOLVED', resolvedAt: new Date('2026-09-05T00:00:00Z') }, new Date('2026-10-01T00:00:00Z'))).toMatchObject({ ageDays: 4, overdue: false, daysLeft: null });
  });
});

describe('documents', () => {
  it('fills dotted placeholders', () => {
    expect(fill('{{order.no}} / {{lines.length}} / {{missing}}', { order: { no: 'A1' }, lines: [1, 2] })).toBe('A1 / 2 / ');
  });
  it('formats sequence numbers with date tokens in IST', () => {
    expect(formatNumber('HS{STATE}{YY}{MM}', 42, 5, new Date('2026-10-31T20:00:00Z'), { STATE: 'WB' })).toBe('HSWB261100042');
  });
});
