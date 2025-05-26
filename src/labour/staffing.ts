/**
 * Working out who has to be called in.
 *
 * The head count for a role is the covers divided by the ratio, rounded up,
 * floored at whatever minimum the property sets. A supervisory role divides
 * the server count rather than the cover count, so raising the guarantee can
 * add a captain without anybody having touched the captain rule.
 *
 * The count is taken against the covers the room is set for, not the
 * guarantee. Somebody has to pour water for the spare places.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { calendarDate, compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { isCurrencyCode, money, type Money } from '../core/money.js';
import { isServiceStyle, type ServiceStyle } from '../property/types.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';
import { isRole, isSupervisory, type LabourRate, type Role, type StaffingRule } from './types.js';

interface RuleRow {
  property_code: string;
  service_style: string;
  role: string;
  covers_per_head: number;
  minimum_heads: number;
  minimum_hours: number;
  lead_in_minutes: number;
  lead_out_minutes: number;
}

function toRule(row: RuleRow): StaffingRule {
  return {
    propertyCode: catalogCode(row.property_code),
    serviceStyle: row.service_style as ServiceStyle,
    role: row.role as Role,
    coversPerHead: row.covers_per_head,
    minimumHeads: row.minimum_heads,
    minimumHours: row.minimum_hours,
    leadInMinutes: row.lead_in_minutes,
    leadOutMinutes: row.lead_out_minutes,
  };
}

export interface SetStaffingRuleInput {
  readonly serviceStyle: string;
  readonly role: string;
  readonly coversPerHead: number;
  readonly minimumHeads?: number;
  readonly minimumHours?: number;
  readonly leadInMinutes?: number;
  readonly leadOutMinutes?: number;
}

export function setStaffingRule(
  db: Database,
  propertyCode: CatalogCode,
  input: SetStaffingRuleInput,
): StaffingRule {
  requireProperty(db, propertyCode);
  const serviceStyle = input.serviceStyle.trim().toUpperCase();
  if (!isServiceStyle(serviceStyle)) {
    throw invalidInput('staffing.style', `${input.serviceStyle} is not a service style`);
  }
  const role = input.role.trim().toUpperCase();
  if (!isRole(role)) {
    throw invalidInput('staffing.role', `${input.role} is not a role this property rosters`);
  }
  if (!Number.isInteger(input.coversPerHead) || input.coversPerHead < 1) {
    throw invalidInput(
      'staffing.ratio',
      `a ratio is one head per a whole number of covers, got ${input.coversPerHead}`,
    );
  }
  const minimumHeads = input.minimumHeads ?? 0;
  if (!Number.isInteger(minimumHeads) || minimumHeads < 0) {
    throw invalidInput('staffing.minimum', 'a minimum head count is a whole number');
  }
  const minimumHours = input.minimumHours ?? 4;
  if (!Number.isInteger(minimumHours) || minimumHours < 1) {
    throw invalidInput('staffing.minimum', 'a minimum call is at least one whole hour');
  }

  db.prepare(
    `insert into staffing_rule (property_code, service_style, role, covers_per_head,
      minimum_heads, minimum_hours, lead_in_minutes, lead_out_minutes)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (property_code, service_style, role) do update set
       covers_per_head = excluded.covers_per_head,
       minimum_heads = excluded.minimum_heads,
       minimum_hours = excluded.minimum_hours,
       lead_in_minutes = excluded.lead_in_minutes,
       lead_out_minutes = excluded.lead_out_minutes`,
  ).run(
    propertyCode,
    serviceStyle,
    role,
    input.coversPerHead,
    minimumHeads,
    minimumHours,
    input.leadInMinutes ?? 60,
    input.leadOutMinutes ?? 30,
  );

  return requireStaffingRule(db, propertyCode, serviceStyle, role);
}

export function findStaffingRule(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
  role: Role,
): StaffingRule | undefined {
  const row = db
    .prepare<
      [string, string, string],
      RuleRow
    >('select * from staffing_rule where property_code = ? and service_style = ? and role = ?')
    .get(propertyCode, serviceStyle, role);
  return row === undefined ? undefined : toRule(row);
}

export function requireStaffingRule(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
  role: Role,
): StaffingRule {
  const found = findStaffingRule(db, propertyCode, serviceStyle, role);
  if (found === undefined) {
    throw notFound(
      'staffing.missing',
      role,
      `${propertyCode} has no ${role} rule for ${serviceStyle} service`,
    );
  }
  return found;
}

export function listStaffingRules(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle?: ServiceStyle,
): StaffingRule[] {
  const clause = serviceStyle === undefined ? '' : ' and service_style = ?';
  const params = serviceStyle === undefined ? [propertyCode] : [propertyCode, serviceStyle];
  return db
    .prepare<string[], RuleRow>(
      `select * from staffing_rule where property_code = ?${clause} order by service_style, role`,
    )
    .all(...params)
    .map(toRule);
}

export interface HeadCount {
  readonly role: Role;
  readonly heads: number;
  readonly rule: StaffingRule;
}

/**
 * Head counts for one function. Non supervisory roles divide the covers; a
 * supervisory role divides the servers that came out of the same pass, so the
 * order the roles are worked out in matters and servers are always first.
 */
export function headCounts(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
  covers: number,
): HeadCount[] {
  if (!Number.isInteger(covers) || covers < 0) {
    throw invalidInput('staffing.covers', 'a cover count is a whole number');
  }
  const rules = listStaffingRules(db, propertyCode, serviceStyle);
  const ordered = [
    ...rules.filter((rule) => !isSupervisory(rule.role)),
    ...rules.filter((rule) => isSupervisory(rule.role)),
  ];

  let servers = 0;
  const out: HeadCount[] = [];
  for (const rule of ordered) {
    const base = isSupervisory(rule.role) ? servers : covers;
    const heads =
      base === 0 ? 0 : Math.max(Math.ceil(base / rule.coversPerHead), rule.minimumHeads);
    if (rule.role === 'SERVER') {
      servers = heads;
    }
    out.push({ role: rule.role, heads, rule });
  }

  return out.sort((left, right) => left.role.localeCompare(right.role));
}

export function setLabourRate(
  db: Database,
  propertyCode: CatalogCode,
  role: string,
  effectiveFrom: string,
  hourlyMinor: number,
): LabourRate {
  const property = requireProperty(db, propertyCode);
  const normalised = role.trim().toUpperCase();
  if (!isRole(normalised)) {
    throw invalidInput('labour.role', `${role} is not a role this property rosters`);
  }
  if (!Number.isSafeInteger(hourlyMinor) || hourlyMinor < 0) {
    throw invalidInput('labour.rate', 'an hourly rate is a whole number of minor units');
  }
  if (!isCurrencyCode(property.currency)) {
    throw conflict('labour.currency', `${propertyCode} has no currency this build holds`);
  }
  const from = calendarDate(effectiveFrom);
  db.prepare(
    `insert into labour_rate (property_code, role, effective_from, hourly_minor)
     values (?, ?, ?, ?)
     on conflict (property_code, role, effective_from)
     do update set hourly_minor = excluded.hourly_minor`,
  ).run(propertyCode, normalised, from, hourlyMinor);
  return { role: normalised, effectiveFrom: from, hourly: money(hourlyMinor, property.currency) };
}

export function findLabourRate(
  db: Database,
  propertyCode: CatalogCode,
  role: Role,
  on: CalendarDate,
): Money | undefined {
  const property = requireProperty(db, propertyCode);
  const row = db
    .prepare<[string, string, string], { hourly_minor: number }>(
      `select hourly_minor from labour_rate
       where property_code = ? and role = ? and effective_from <= ?
       order by effective_from desc limit 1`,
    )
    .get(propertyCode, role, on);
  return row === undefined ? undefined : money(row.hourly_minor, property.currency);
}

export function requireLabourRate(
  db: Database,
  propertyCode: CatalogCode,
  role: Role,
  on: CalendarDate,
): Money {
  const found = findLabourRate(db, propertyCode, role, on);
  if (found === undefined) {
    throw notFound('labour.rate', role, `${propertyCode} has no ${role} rate in force on ${on}`);
  }
  return found;
}

export function labourRateHistory(
  db: Database,
  propertyCode: CatalogCode,
  role: Role,
): LabourRate[] {
  const property = requireProperty(db, propertyCode);
  return db
    .prepare<[string, string], { effective_from: string; hourly_minor: number }>(
      `select effective_from, hourly_minor from labour_rate
       where property_code = ? and role = ? order by effective_from`,
    )
    .all(propertyCode, role)
    .map((row) => ({
      role,
      effectiveFrom: calendarDate(row.effective_from),
      hourly: money(row.hourly_minor, property.currency),
    }));
}

/** Whether a rate change lands before a function that is already sold. */
export function rateChangesBefore(
  rates: readonly LabourRate[],
  serviceDate: CalendarDate,
): LabourRate[] {
  return rates.filter((rate) => compareCalendarDates(rate.effectiveFrom, serviceDate) <= 0);
}
