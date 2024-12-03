/**
 * One error type for everything the domain refuses to do.
 *
 * The command line, the read service and the tests all need to tell a rule
 * the domain enforced apart from a bug, and they need to do it without
 * matching on message text. Every refusal carries a stable code and, where it
 * helps, the identifiers involved.
 */

export type DomainErrorKind =
  | 'invalid-input'
  | 'not-found'
  | 'conflict'
  | 'rule-violation'
  | 'deadline-passed'
  | 'capacity-exceeded'
  | 'not-permitted';

export interface DomainErrorDetail {
  readonly kind: DomainErrorKind;
  readonly code: string;
  readonly subject?: string;
  readonly hint?: string;
}

export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  readonly code: string;
  readonly subject: string | undefined;
  readonly hint: string | undefined;

  constructor(message: string, detail: DomainErrorDetail) {
    super(message);
    this.name = 'DomainError';
    this.kind = detail.kind;
    this.code = detail.code;
    this.subject = detail.subject;
    this.hint = detail.hint;
  }

  toJSON(): Record<string, string> {
    const out: Record<string, string> = {
      error: this.code,
      kind: this.kind,
      message: this.message,
    };
    if (this.subject !== undefined) out.subject = this.subject;
    if (this.hint !== undefined) out.hint = this.hint;
    return out;
  }
}

export function invalidInput(code: string, message: string, hint?: string): DomainError {
  return new DomainError(message, { kind: 'invalid-input', code, ...(hint ? { hint } : {}) });
}

export function notFound(code: string, subject: string, message?: string): DomainError {
  return new DomainError(message ?? `${subject} is not on file`, {
    kind: 'not-found',
    code,
    subject,
  });
}

export function conflict(code: string, message: string, subject?: string): DomainError {
  return new DomainError(message, { kind: 'conflict', code, ...(subject ? { subject } : {}) });
}

export function ruleViolation(code: string, message: string, hint?: string): DomainError {
  return new DomainError(message, { kind: 'rule-violation', code, ...(hint ? { hint } : {}) });
}

export function deadlinePassed(code: string, message: string, hint?: string): DomainError {
  return new DomainError(message, { kind: 'deadline-passed', code, ...(hint ? { hint } : {}) });
}

export function capacityExceeded(code: string, message: string, subject?: string): DomainError {
  return new DomainError(message, {
    kind: 'capacity-exceeded',
    code,
    ...(subject ? { subject } : {}),
  });
}

export function notPermitted(code: string, message: string): DomainError {
  return new DomainError(message, { kind: 'not-permitted', code });
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/** Every error the domain raises, with the message flattened for a log line. */
export function describeError(value: unknown): string {
  if (isDomainError(value)) {
    return `${value.code}: ${value.message}`;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return String(value);
}
