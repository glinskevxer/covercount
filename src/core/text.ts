/**
 * Free text, with an end to it.
 *
 * Most of the text in this build is unbounded, and it reads as harmless: a
 * note on a charge line, a reason on a cancellation, the attendees at a
 * tasting. None of them is harmless once the row is copied into a banquet
 * event order snapshot, which is then read back on every drift check, printed
 * on a sheet with a fixed margin, and served as JSON to a screen on a wall.
 *
 * The limits here are the ones the paper actually has. A reader board line is
 * sixty characters because that is what fits on the board. A note is a
 * paragraph because a note that needs more than a paragraph is a document and
 * belongs in one. Neither is a security control; they are the shape of the
 * thing being described, which is why they differ.
 */

import { invalidInput } from './errors.js';

/** What fits on the reader board in the lobby. */
export const BOARD_LINE = 60;

/** A name on a record: a room, an account, a planner, a supplier. */
export const NAME = 120;

/** One line of description on a charge, a step or an item. */
export const LINE = 200;

/** A paragraph somebody types into a note field. */
export const NOTE = 1_000;

/** An external reference: a purchase order number, a cheque, a delivery note. */
export const REFERENCE = 64;

export interface BoundedOptions {
  /** Whether an empty value is allowed once it has been trimmed. */
  readonly required?: boolean;
  /** The code the refusal carries, so a caller can branch on the field. */
  readonly code?: string;
}

/**
 * Trim, then check.
 *
 * In that order on purpose: a value that is under the limit once its trailing
 * whitespace is gone is under the limit, and refusing it because somebody's
 * paste carried forty spaces is a refusal nobody can act on.
 */
export function boundedText(
  label: string,
  value: string,
  max: number,
  options: BoundedOptions = {},
): string {
  const trimmed = value.trim();
  if (options.required === true && trimmed.length === 0) {
    throw invalidInput(options.code ?? 'text.required', `${label} cannot be blank`);
  }
  if (trimmed.length > max) {
    throw invalidInput(
      options.code ?? 'text.long',
      `${label} takes ${max} characters and this is ${trimmed.length}`,
    );
  }
  return trimmed;
}

/**
 * Text bound for a single printed line.
 *
 * A newline in a value that gets printed on one line does not truncate it, it
 * rearranges the whole sheet under it, so it is refused rather than stripped:
 * silently rewriting what somebody typed is how a name on a contract stops
 * matching the name on the invoice.
 */
export function singleLine(
  label: string,
  value: string,
  max: number,
  options: BoundedOptions = {},
): string {
  const trimmed = boundedText(label, value, max, options);
  if (/[\r\n]/.test(trimmed)) {
    throw invalidInput(options.code ?? 'text.newline', `${label} goes on one line`);
  }
  return trimmed;
}
