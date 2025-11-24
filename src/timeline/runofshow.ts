/**
 * Back timing a function.
 *
 * The service times are fixed and everything else is worked out backwards from
 * them. A step carries an anchor, an offset in minutes, and an allowance in
 * seconds per cover. The allowance is what makes the timeline follow the
 * guarantee: plating a hundred and eighty covers takes longer than plating
 * forty, so the kitchen has to start earlier, and nobody should have to
 * remember to retype that when the count moves.
 *
 * A step is allowed to land before midnight of the service date, which is what
 * happens when a late supper's mise en place starts the previous evening.
 */

import { formatBlockMinute } from '../core/clock.js';
import { invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { divideRound } from '../core/rounding.js';
import { requireFunction } from '../booking/functions.js';
import { isServiceStyle, type ServiceStyle } from '../property/types.js';
import { requireProperty, requireSpace } from '../property/store.js';
import { requireCovers } from '../covers/guarantee.js';
import { coverBreakdown } from '../covers/special.js';
import { inTransaction, type Database } from '../store/database.js';

export const ANCHORS = ['SETUP', 'DOORS', 'SERVICE', 'CLOSE', 'TEARDOWN'] as const;

export type Anchor = (typeof ANCHORS)[number];

export function isAnchor(value: string): value is Anchor {
  return (ANCHORS as readonly string[]).includes(value);
}

export interface TemplateStep {
  readonly propertyCode: CatalogCode;
  readonly serviceStyle: ServiceStyle;
  readonly sequence: number;
  readonly label: string;
  readonly anchor: Anchor;
  readonly offsetMinutes: number;
  readonly perCoverSeconds: number;
  readonly owner: string;
}

export interface TimelineStep {
  readonly sequence: number;
  readonly label: string;
  readonly minute: number;
  readonly owner: string;
  readonly note: string;
  readonly pinned: boolean;
}

interface TemplateRow {
  property_code: string;
  service_style: string;
  sequence: number;
  label: string;
  anchor: string;
  offset_minutes: number;
  per_cover_seconds: number;
  owner: string;
}

interface StepRow {
  sequence: number;
  label: string;
  minute: number;
  owner: string;
  note: string;
  pinned: number;
}

function toTemplate(row: TemplateRow): TemplateStep {
  return {
    propertyCode: row.property_code as CatalogCode,
    serviceStyle: row.service_style as ServiceStyle,
    sequence: row.sequence,
    label: row.label,
    anchor: row.anchor as Anchor,
    offsetMinutes: row.offset_minutes,
    perCoverSeconds: row.per_cover_seconds,
    owner: row.owner,
  };
}

export interface SetTemplateStepInput {
  readonly serviceStyle: string;
  readonly sequence: number;
  readonly label: string;
  readonly anchor: string;
  readonly offsetMinutes?: number;
  readonly perCoverSeconds?: number;
  readonly owner?: string;
}

export function setTemplateStep(
  db: Database,
  propertyCode: CatalogCode,
  input: SetTemplateStepInput,
): TemplateStep {
  requireProperty(db, propertyCode);
  const serviceStyle = input.serviceStyle.trim().toUpperCase();
  if (!isServiceStyle(serviceStyle)) {
    throw invalidInput('timeline.style', `${input.serviceStyle} is not a service style`);
  }
  const anchor = input.anchor.trim().toUpperCase();
  if (!isAnchor(anchor)) {
    throw invalidInput('timeline.anchor', `${input.anchor} is not an anchor a step hangs off`);
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw invalidInput('timeline.sequence', 'a step sequence is a whole number of one or more');
  }
  if (input.label.trim().length === 0) {
    throw invalidInput('timeline.label', 'a step needs a label');
  }
  const perCoverSeconds = input.perCoverSeconds ?? 0;
  if (!Number.isInteger(perCoverSeconds) || perCoverSeconds < 0) {
    throw invalidInput(
      'timeline.allowance',
      'a per cover allowance is whole seconds, zero or more',
    );
  }

  db.prepare(
    `insert into timeline_template (property_code, service_style, sequence, label, anchor,
      offset_minutes, per_cover_seconds, owner)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (property_code, service_style, sequence) do update set
       label = excluded.label,
       anchor = excluded.anchor,
       offset_minutes = excluded.offset_minutes,
       per_cover_seconds = excluded.per_cover_seconds,
       owner = excluded.owner`,
  ).run(
    propertyCode,
    serviceStyle,
    input.sequence,
    input.label.trim(),
    anchor,
    input.offsetMinutes ?? 0,
    perCoverSeconds,
    (input.owner ?? '').trim(),
  );

  return requireTemplateStep(db, propertyCode, serviceStyle, input.sequence);
}

export function requireTemplateStep(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
  sequence: number,
): TemplateStep {
  const row = db
    .prepare<[string, string, number], TemplateRow>(
      `select * from timeline_template
       where property_code = ? and service_style = ? and sequence = ?`,
    )
    .get(propertyCode, serviceStyle, sequence);
  if (row === undefined) {
    throw notFound(
      'timeline.missing',
      String(sequence),
      `${propertyCode} has no ${serviceStyle} step ${sequence}`,
    );
  }
  return toTemplate(row);
}

export function listTemplate(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
): TemplateStep[] {
  return db
    .prepare<[string, string], TemplateRow>(
      `select * from timeline_template
       where property_code = ? and service_style = ? order by sequence`,
    )
    .all(propertyCode, serviceStyle)
    .map(toTemplate);
}

export interface AnchorMinutes {
  readonly SETUP: number;
  readonly DOORS: number;
  readonly SERVICE: number;
  readonly CLOSE: number;
  readonly TEARDOWN: number;
}

/**
 * The five fixed points a step can hang off. Setup and teardown come from the
 * room rather than the function, because they are how long the crew needs, not
 * anything the client agreed.
 */
export function anchorsFor(db: Database, functionId: EntityId<'functionSlot'>): AnchorMinutes {
  const slot = requireFunction(db, functionId);
  const space = requireSpace(db, slot.propertyCode, slot.spaceCode);
  return {
    SETUP: slot.startMinute - space.setupMinutes,
    DOORS: slot.startMinute,
    SERVICE: slot.startMinute + 30,
    CLOSE: slot.endMinute,
    TEARDOWN: slot.endMinute + space.teardownMinutes,
  };
}

/**
 * Work the template out against a function. A step with an allowance starts
 * earlier the more covers there are, so the returned minute is the anchor plus
 * the offset minus the allowance.
 */
export function computeRunOfShow(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  options: { covers?: number } = {},
): TimelineStep[] {
  const slot = requireFunction(db, functionId);
  const anchors = anchorsFor(db, functionId);

  let covers = options.covers;
  if (covers === undefined) {
    const counted = requireCovers(db, functionId);
    covers =
      counted.guaranteedCovers === undefined
        ? slot.expectedCovers
        : coverBreakdown(db, functionId).setFor;
  }

  return listTemplate(db, slot.propertyCode, slot.serviceStyle).map((step) => {
    const allowance =
      step.perCoverSeconds === 0 ? 0 : divideRound(step.perCoverSeconds * covers, 60, 'up');
    return {
      sequence: step.sequence,
      label: step.label,
      minute: anchors[step.anchor] + step.offsetMinutes - allowance,
      owner: step.owner,
      note: '',
      pinned: false,
    };
  });
}

/** Freeze the computed run of show, keeping any step somebody pinned by hand. */
export function saveRunOfShow(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  options: { covers?: number } = {},
): TimelineStep[] {
  const computed = computeRunOfShow(db, functionId, options);
  return inTransaction(db, (handle) => {
    const pinned = listRunOfShow(handle, functionId).filter((step) => step.pinned);
    handle
      .prepare('delete from function_timeline where function_id = ? and pinned = 0')
      .run(functionId);
    const insert = handle.prepare(
      `insert into function_timeline (function_id, sequence, label, minute, owner, note, pinned)
       values (?, ?, ?, ?, ?, ?, 0)
       on conflict (function_id, sequence) do nothing`,
    );
    for (const step of computed) {
      if (pinned.some((each) => each.sequence === step.sequence)) {
        continue;
      }
      insert.run(functionId, step.sequence, step.label, step.minute, step.owner, step.note);
    }
    return listRunOfShow(handle, functionId);
  });
}

export function listRunOfShow(db: Database, functionId: EntityId<'functionSlot'>): TimelineStep[] {
  return db
    .prepare<[string], StepRow>(
      'select * from function_timeline where function_id = ? order by minute, sequence',
    )
    .all(functionId)
    .map((row) => ({
      sequence: row.sequence,
      label: row.label,
      minute: row.minute,
      owner: row.owner,
      note: row.note,
      pinned: row.pinned === 1,
    }));
}

/** Fix one step at a time somebody has decided on, so a redraw leaves it alone. */
export function pinStep(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  sequence: number,
  minute: number,
  note = '',
): TimelineStep[] {
  requireFunction(db, functionId);
  if (!Number.isInteger(minute)) {
    throw invalidInput('timeline.minute', 'a pinned step lands on a whole minute');
  }
  const existing = listRunOfShow(db, functionId).find((step) => step.sequence === sequence);
  if (existing === undefined) {
    throw notFound(
      'timeline.step',
      String(sequence),
      `${functionId} has no step ${sequence} to pin`,
    );
  }
  db.prepare(
    'update function_timeline set minute = ?, note = ?, pinned = 1 where function_id = ? and sequence = ?',
  ).run(minute, note.trim(), functionId, sequence);
  return listRunOfShow(db, functionId);
}

export function unpinStep(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  sequence: number,
): TimelineStep[] {
  db.prepare('update function_timeline set pinned = 0 where function_id = ? and sequence = ?').run(
    functionId,
    sequence,
  );
  return listRunOfShow(db, functionId);
}

/** The run of show as a person reads it, one line per step. */
export function renderRunOfShow(steps: readonly TimelineStep[]): string {
  if (steps.length === 0) {
    return 'no run of show';
  }
  const width = steps.reduce((widest, step) => Math.max(widest, step.label.length), 0);
  return steps
    .map((step) => {
      const clock = formatBlockMinute(step.minute, ' (next)');
      const owner = step.owner.length > 0 ? `  ${step.owner}` : '';
      const pin = step.pinned ? ' *' : '';
      return `${clock.padStart(12)}  ${step.label.padEnd(width)}${owner}${pin}`;
    })
    .join('\n');
}
