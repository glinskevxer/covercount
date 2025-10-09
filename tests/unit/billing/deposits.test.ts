import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { seedPropertyAccountBooking } from '../../support/fixtures.js';
import {
  cancellationCharge,
  cancellationLadder,
  depositSchedule,
  depositsDue,
  depositsTotal,
  removeDepositStep,
  setCancellationStep,
  setDepositStep,
} from '../../../src/billing/deposits.js';
import { formatMoney, money } from '../../../src/core/money.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { ratePercent } from '../../../src/core/rate.js';
import type { Database } from '../../../src/store/database.js';

const d = calendarDate;
const CONTRACTED = money(2_000_000, 'USD');

function laddered(db: Database) {
  const booking = seedPropertyAccountBooking(db);
  setDepositStep(db, booking.id, {
    sequence: 1,
    label: 'on signature',
    daysBefore: 365,
    fixedMinor: 100_000,
  });
  setDepositStep(db, booking.id, {
    sequence: 2,
    label: 'ninety days out',
    daysBefore: 90,
    percentPpm: 250_000,
  });
  setDepositStep(db, booking.id, {
    sequence: 3,
    label: 'balance',
    daysBefore: 3,
    percentPpm: 750_000,
  });
  return booking;
}

describe('the deposit ladder', () => {
  it('reads the steps back in sequence', () => {
    withStore((db) => {
      const booking = laddered(db);
      const steps = depositSchedule(db, booking.id);
      expect(steps.map((row) => row.label)).toEqual(['on signature', 'ninety days out', 'balance']);
      expect(steps[0]?.fixed.amount).toBe(100_000);
      expect(ratePercent(steps[1]!.percent)).toBe(25);
    });
  });

  it('works out what falls due and when', () => {
    withStore((db) => {
      const booking = laddered(db);
      const due = depositsDue(db, booking.id, CONTRACTED, d('2025-01-01'));
      expect(due[0]?.dueDate).toBe('2024-04-17');
      expect(formatMoney(due[0]!.amount)).toBe('$1,000.00');
      expect(due[1]?.dueDate).toBe('2025-01-17');
      expect(formatMoney(due[1]!.amount)).toBe('$5,000.00');
      expect(due[2]?.dueDate).toBe('2025-04-14');
      expect(formatMoney(due[2]!.amount)).toBe('$15,000.00');
    });
  });

  it('marks a step overdue against the date the office believes it is', () => {
    withStore((db) => {
      const booking = laddered(db);
      const early = depositsDue(db, booking.id, CONTRACTED, d('2024-01-01'));
      expect(early.every((row) => !row.overdue)).toBe(true);
      const late = depositsDue(db, booking.id, CONTRACTED, d('2025-02-01'));
      expect(late.map((row) => row.overdue)).toEqual([true, true, false]);
    });
  });

  it('adds a mixed ladder up to the whole contracted value', () => {
    withStore((db) => {
      const booking = laddered(db);
      const due = depositsDue(db, booking.id, CONTRACTED, d('2025-01-01'));
      expect(formatMoney(depositsTotal(due, 'USD'))).toBe('$21,000.00');
    });
  });

  it('refuses a step that asks for nothing, or a badly formed one', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const base = { sequence: 1, label: 'x', daysBefore: 30 };
      expect(() => setDepositStep(db, booking.id, base)).toThrow(/asks for nothing/);
      expect(() => setDepositStep(db, booking.id, { ...base, sequence: 0, fixedMinor: 1 })).toThrow(
        /whole number of one or more/,
      );
      expect(() => setDepositStep(db, booking.id, { ...base, label: ' ', fixedMinor: 1 })).toThrow(
        /needs a label/,
      );
      expect(() =>
        setDepositStep(db, booking.id, { ...base, daysBefore: -1, fixedMinor: 1 }),
      ).toThrow(/zero or more/);
      expect(() => setDepositStep(db, booking.id, { ...base, fixedMinor: -1 })).toThrow(
        /whole number of minor units/,
      );
    });
  });

  it('replaces a step set twice and takes one back off', () => {
    withStore((db) => {
      const booking = laddered(db);
      setDepositStep(db, booking.id, {
        sequence: 1,
        label: 'on signature',
        daysBefore: 365,
        fixedMinor: 200_000,
      });
      expect(depositSchedule(db, booking.id)[0]?.fixed.amount).toBe(200_000);
      expect(removeDepositStep(db, booking.id, 1)).toBe(true);
      expect(removeDepositStep(db, booking.id, 1)).toBe(false);
      expect(depositSchedule(db, booking.id)).toHaveLength(2);
    });
  });
});

describe('the cancellation ladder', () => {
  function cancellable(db: Database) {
    const booking = seedPropertyAccountBooking(db);
    setCancellationStep(db, booking.id, 90, 250_000);
    setCancellationStep(db, booking.id, 30, 500_000);
    setCancellationStep(db, booking.id, 7, 1_000_000);
    return booking;
  }

  it('prints furthest out first', () => {
    withStore((db) => {
      const booking = cancellable(db);
      expect(cancellationLadder(db, booking.id).map((row) => row.daysBefore)).toEqual([90, 30, 7]);
    });
  });

  it('charges nothing outside the ladder', () => {
    withStore((db) => {
      const booking = cancellable(db);
      const charge = cancellationCharge(db, booking.id, CONTRACTED, d('2024-06-01'));
      expect(charge.amount.amount).toBe(0);
      expect(ratePercent(charge.percent)).toBe(0);
    });
  });

  it('takes the tightest step the date has already passed', () => {
    withStore((db) => {
      const booking = cancellable(db);
      const at60 = cancellationCharge(db, booking.id, CONTRACTED, d('2025-02-16'));
      expect(ratePercent(at60.percent)).toBe(25);
      const at20 = cancellationCharge(db, booking.id, CONTRACTED, d('2025-03-28'));
      expect(ratePercent(at20.percent)).toBe(50);
      const at2 = cancellationCharge(db, booking.id, CONTRACTED, d('2025-04-15'));
      expect(ratePercent(at2.percent)).toBe(100);
      expect(formatMoney(at2.amount)).toBe('$20,000.00');
    });
  });

  it('charges the whole thing once the date has gone past arrival', () => {
    withStore((db) => {
      const booking = cancellable(db);
      const after = cancellationCharge(db, booking.id, CONTRACTED, d('2025-05-01'));
      expect(ratePercent(after.percent)).toBe(100);
    });
  });

  it('refuses a step outside nought to a hundred percent', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => setCancellationStep(db, booking.id, 30, 1_000_001)).toThrow(
        /between zero and a hundred percent/,
      );
      expect(() => setCancellationStep(db, booking.id, -1, 500_000)).toThrow(
        /whole number of days before/,
      );
    });
  });
});
