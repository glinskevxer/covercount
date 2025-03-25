/**
 * When the guarantee closes.
 *
 * The contract says a number of business days before the function, by a time
 * of day, and business days are the sales office ones rather than the
 * kitchen's. The office calendar is data, so the deadline for a Monday
 * function at a property that closes for Presidents Day is a different date
 * from one that does not, and neither of them is three times twenty four
 * hours.
 *
 * The result is a wall clock reading at the property, which the caller turns
 * into an instant to compare against now. Doing it the other way round loses
 * the day whenever a transition falls in between.
 */

import { BusinessCalendar } from '../core/businessdays.js';
import type { CalendarDate } from '../core/calendar.js';
import { toInstant, zonedDateTime, type TimeOfDay, type ZonedDateTime } from '../core/clock.js';
import type { HouseCalendarEntry, Property } from '../property/types.js';

export interface DeadlineInput {
  readonly serviceDate: CalendarDate;
  readonly leadDays: number;
  readonly dueTime: TimeOfDay;
  readonly zone: Property['timeZone'];
  readonly calendar: BusinessCalendar;
}

/**
 * The deadline is counted back from the service date. If the service date is
 * itself a closed day the count still starts there, because the client's
 * obligation is measured against when the kitchen cooks and not against when
 * the office happens to be open.
 */
export function guaranteeDeadline(input: DeadlineInput): ZonedDateTime {
  const date = input.calendar.addBusinessDays(input.serviceDate, -input.leadDays);
  return zonedDateTime(date, input.dueTime, input.zone);
}

export function guaranteeDeadlineFor(
  property: Property,
  serviceDate: CalendarDate,
  calendar: BusinessCalendar,
): ZonedDateTime {
  return guaranteeDeadline({
    serviceDate,
    leadDays: property.guaranteeLeadDays,
    dueTime: property.guaranteeDueTime,
    zone: property.timeZone,
    calendar,
  });
}

/** Build the office calendar out of what the property has on file. */
export function officeCalendar(entries: readonly HouseCalendarEntry[]): BusinessCalendar {
  return new BusinessCalendar({
    holidays: entries
      .filter((entry) => entry.calendar === 'office' && entry.kind === 'closed')
      .map((entry) => entry.date),
    workingExceptions: entries
      .filter((entry) => entry.calendar === 'office' && entry.kind === 'open')
      .map((entry) => entry.date),
  });
}

export function kitchenCalendar(entries: readonly HouseCalendarEntry[]): BusinessCalendar {
  return new BusinessCalendar({
    closedWeekdays: [],
    holidays: entries
      .filter((entry) => entry.calendar === 'kitchen' && entry.kind === 'closed')
      .map((entry) => entry.date),
    workingExceptions: entries
      .filter((entry) => entry.calendar === 'kitchen' && entry.kind === 'open')
      .map((entry) => entry.date),
  });
}

export function deadlineHasPassed(deadline: ZonedDateTime, nowIso: string): boolean {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    return false;
  }
  return now >= toInstant(deadline);
}

/** Whole hours from now until the deadline, negative once it is behind us. */
export function hoursUntilDeadline(deadline: ZonedDateTime, nowIso: string): number {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    return 0;
  }
  return Math.floor((toInstant(deadline) - now) / 3_600_000);
}
