/**
 * How a printed sheet is put together.
 *
 * Every report in this build prints the same shape: a heading, a summary line
 * or two, then some blocks of indented rows with a blank line between them.
 * Six of them were each building that with an array of strings, a handful of
 * `push` calls and their own rule about when a section is empty enough to
 * leave out.
 *
 * The rules were not quite the same in any two of them, which is the actual
 * cost: one printed an empty heading, one printed a heading and the words
 * "none", and one silently printed nothing at all. This is one answer.
 */

export interface Section {
  readonly title: string;
  readonly rows: readonly string[];
  /** What to print instead when there are no rows. Nothing hides the section. */
  readonly whenEmpty?: string;
}

export interface SheetInput {
  readonly heading: string;
  /** Lines under the heading, before the first section. */
  readonly summary?: readonly string[];
  readonly sections?: readonly Section[];
  /** Printed on its own when every section is empty and nothing was hidden. */
  readonly whenBare?: string;
}

const INDENT = '  ';

/** One row of a section, indented and with its trailing space taken off. */
export function row(...parts: readonly string[]): string {
  return `${INDENT}${parts.join('')}`.trimEnd();
}

/** A row nested under another, for the detail under a line that needs it. */
export function subRow(...parts: readonly string[]): string {
  return `${INDENT}${INDENT}${INDENT}${parts.join('')}`.trimEnd();
}

export function padRight(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

export function padLeft(value: string | number, width: number): string {
  return String(value).padStart(width);
}

/**
 * Assemble the sheet.
 *
 * A section with no rows and no empty message is left out entirely, heading
 * included, because a heading with nothing under it is the thing that stops
 * people reading a report. A section that names an empty message keeps its
 * place and says so, which is what a reader wants where the absence is the
 * news.
 */
export function sheet(input: SheetInput): string {
  const lines: string[] = [input.heading, ...(input.summary ?? [])];
  let printed = 0;

  for (const section of input.sections ?? []) {
    if (section.rows.length === 0 && section.whenEmpty === undefined) {
      continue;
    }
    printed += 1;
    lines.push('');
    if (section.title.length > 0) {
      lines.push(section.title);
    }
    if (section.rows.length === 0) {
      lines.push(row(section.whenEmpty ?? ''));
      continue;
    }
    lines.push(...section.rows);
  }

  if (printed === 0 && input.whenBare !== undefined) {
    lines.push('');
    lines.push(input.whenBare);
  }
  return lines.join('\n');
}
