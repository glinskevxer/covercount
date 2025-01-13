import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_KINDS,
  BOOKING_STATUSES,
  CREDIT_STATUSES,
  FUNCTION_STATUSES,
  crossesMidnight,
  functionDurationMinutes,
  holdsSpace,
  isAccountKind,
  isBookingStatus,
  isCreditStatus,
  isFinished,
  isFunctionStatus,
  isProvisional,
  startTimeOfDay,
} from '../../../src/booking/types.js';

describe('the vocabularies', () => {
  it('recognises a booking status', () => {
    for (const status of BOOKING_STATUSES) {
      expect(isBookingStatus(status)).toBe(true);
    }
    expect(isBookingStatus('PENCILLED')).toBe(false);
    expect(isBookingStatus('definite')).toBe(false);
  });

  it('recognises a function status', () => {
    for (const status of FUNCTION_STATUSES) {
      expect(isFunctionStatus(status)).toBe(true);
    }
    expect(isFunctionStatus('PENDING')).toBe(false);
  });

  it('recognises an account kind and a credit status', () => {
    expect(ACCOUNT_KINDS).toContain('ASSOCIATION');
    expect(isAccountKind('CORPORATE')).toBe(true);
    expect(isAccountKind('WEDDING')).toBe(false);
    expect(CREDIT_STATUSES).toEqual(['APPROVED', 'PREPAY', 'HOLD']);
    expect(isCreditStatus('HOLD')).toBe(true);
    expect(isCreditStatus('BLOCKED')).toBe(false);
  });
});

describe('what a status means', () => {
  it('calls an inquiry and a tentative provisional', () => {
    expect(isProvisional('INQUIRY')).toBe(true);
    expect(isProvisional('TENTATIVE')).toBe(true);
    expect(isProvisional('DEFINITE')).toBe(false);
    expect(isProvisional('CANCELLED')).toBe(false);
  });

  it('calls a cancelled and a closed booking finished', () => {
    expect(isFinished('CANCELLED')).toBe(true);
    expect(isFinished('CLOSED')).toBe(true);
    expect(isFinished('DEFINITE')).toBe(false);
    expect(isFinished('INQUIRY')).toBe(false);
  });

  it('says a held and a definite function still block the room', () => {
    expect(holdsSpace('HELD')).toBe(true);
    expect(holdsSpace('DEFINITE')).toBe(true);
    expect(holdsSpace('RELEASED')).toBe(false);
    expect(holdsSpace('CANCELLED')).toBe(false);
  });
});

describe('a function that runs late', () => {
  it('measures its length across midnight', () => {
    expect(functionDurationMinutes({ startMinute: 1080, endMinute: 1500 })).toBe(420);
    expect(functionDurationMinutes({ startMinute: 660, endMinute: 840 })).toBe(180);
  });

  it('reports when it passes midnight', () => {
    expect(crossesMidnight({ endMinute: 1500 })).toBe(true);
    expect(crossesMidnight({ endMinute: 1440 })).toBe(false);
    expect(crossesMidnight({ endMinute: 840 })).toBe(false);
  });

  it('reads its start as a time of day', () => {
    expect(startTimeOfDay({ startMinute: 1080 })).toBe(1080);
  });
});
