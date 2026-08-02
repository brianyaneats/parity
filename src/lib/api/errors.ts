import { z } from 'zod';
import { DomainError } from '@/domain/shared/DomainError';

/**
 * The uniform error envelope — §5.1.
 *
 * ```jsonc
 * { "error": { "code": "VALIDATION_FAILED", "message": "human readable",
 *              "fields": { "nights": "must be at least 1" } } }
 * ```
 *
 * The shape is fixed because clients depend on it. §13.1 says the specific
 * codes beyond the listed set are ours to choose, so a few domain-specific ones
 * are added below.
 *
 * "Never leak a stack trace to the client." The envelope carries a message and
 * optional field errors; the stack goes to the log, keyed by the same request
 * id that is returned in `X-Request-Id`.
 */

export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly fields?: Readonly<Record<string, string>>;
    readonly requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public get status(): number {
    return ERROR_STATUS[this.code];
  }

  public static unauthorized(message = 'Sign in to continue.'): ApiError {
    return new ApiError('UNAUTHORIZED', message);
  }

  public static forbidden(message = 'You do not have access to this resource.'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }

  public static notFound(what = 'Resource'): ApiError {
    return new ApiError('NOT_FOUND', `${what} not found.`);
  }

  public static conflict(message: string): ApiError {
    return new ApiError('CONFLICT', message);
  }

  public static validation(message: string, fields?: Record<string, string>): ApiError {
    return new ApiError('VALIDATION_FAILED', message, fields);
  }

  public static rateLimited(message = 'Too many requests. Try again shortly.'): ApiError {
    return new ApiError('RATE_LIMITED', message);
  }
}

/**
 * Flattens a Zod issue list into the envelope's `fields` map.
 *
 * Keeps the *first* message per path. A field with three simultaneous
 * complaints renders as one actionable sentence rather than a wall, which is
 * what §7.3's inline error state needs.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

export function envelopeFor(error: unknown, requestId: string): {
  status: number;
  body: ErrorEnvelope;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          requestId,
        },
      },
    };
  }

  if (error instanceof z.ZodError) {
    return {
      status: ERROR_STATUS.VALIDATION_FAILED,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some values need fixing.',
          fields: fieldErrorsFrom(error),
          requestId,
        },
      },
    };
  }

  // A DomainError means an invariant we own was violated — that is a bug, not
  // user input. It maps to 500 and the details go to the log, never the client.
  if (error instanceof DomainError) {
    return {
      status: ERROR_STATUS.INTERNAL,
      body: {
        error: {
          code: 'INTERNAL',
          message: 'Something went wrong computing that. The error has been logged.',
          requestId,
        },
      },
    };
  }

  return {
    status: ERROR_STATUS.INTERNAL,
    body: {
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong. The error has been logged.',
        requestId,
      },
    },
  };
}
