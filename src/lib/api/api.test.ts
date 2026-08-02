import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ApiError, ERROR_STATUS, envelopeFor, fieldErrorsFrom } from './errors';
import { DomainError } from '@/domain/shared/DomainError';

/**
 * §5.1 fixes the error envelope shape because clients depend on it, and adds
 * one hard rule: "Never leak a stack trace to the client. Log with a request id
 * and return it in `X-Request-Id`."
 *
 * These tests exist mostly to pin that second rule down. An envelope that
 * quietly starts carrying `error.stack` in a later refactor is a security
 * regression that no feature test would catch.
 */

describe('ApiError', () => {
  it('maps each code to the status §5.1 specifies', () => {
    expect(ApiError.unauthorized().status).toBe(401);
    expect(ApiError.forbidden().status).toBe(403);
    expect(ApiError.notFound().status).toBe(404);
    expect(ApiError.validation('bad').status).toBe(422);
    expect(ApiError.rateLimited().status).toBe(429);
    expect(new ApiError('INTERNAL', 'boom').status).toBe(500);
  });

  it('exposes the full code table', () => {
    expect(ERROR_STATUS).toMatchObject({
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      VALIDATION_FAILED: 422,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    });
  });

  it('names the missing resource without leaking an id', () => {
    expect(ApiError.notFound('Claim').message).toBe('Claim not found.');
  });

  it('survives instanceof across the prototype restoration', () => {
    const error = ApiError.forbidden();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('fieldErrorsFrom', () => {
  const schema = z.object({
    nights: z.number().int().min(1, 'must be at least 1'),
    totalCents: z.number().int('must be a whole number of cents'),
    nested: z.object({ tax: z.number().min(0, 'cannot be negative') }),
  });

  it('keys messages by dotted path so the UI can place them inline', () => {
    const result = schema.safeParse({ nights: 0, totalCents: 1.5, nested: { tax: -1 } });
    const fields = fieldErrorsFrom(result.error!);

    expect(fields.nights).toBe('must be at least 1');
    expect(fields.totalCents).toBe('must be a whole number of cents');
    expect(fields['nested.tax']).toBe('cannot be negative');
  });

  it('keeps only the first message per field', () => {
    // Three simultaneous complaints on one input render as one actionable
    // sentence, not a wall — §7.3's inline error state depends on it.
    const strict = z.object({ n: z.number().int('must be whole').min(5, 'must be at least 5') });
    const fields = fieldErrorsFrom(strict.safeParse({ n: 1.5 }).error!);
    expect(Object.keys(fields)).toEqual(['n']);
  });

  it('uses a placeholder key for a root-level issue', () => {
    const rooted = z.object({ a: z.number() }).refine(() => false, { message: 'no good' });
    expect(fieldErrorsFrom(rooted.safeParse({ a: 1 }).error!)).toEqual({ _: 'no good' });
  });
});

describe('envelopeFor — §5.1', () => {
  const requestId = 'req-abc';

  it('renders an ApiError with its code, message and fields', () => {
    const { status, body } = envelopeFor(
      ApiError.validation('Some values need fixing.', { nights: 'must be at least 1' }),
      requestId,
    );

    expect(status).toBe(422);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some values need fixing.',
        fields: { nights: 'must be at least 1' },
        requestId,
      },
    });
  });

  it('omits the fields key entirely when there are none', () => {
    const { body } = envelopeFor(ApiError.unauthorized(), requestId);
    expect('fields' in body.error).toBe(false);
  });

  it('turns a raw ZodError into a 422 with per-field messages', () => {
    const schema = z.object({ nights: z.number().min(1, 'must be at least 1') });
    const { status, body } = envelopeFor(schema.safeParse({ nights: 0 }).error, requestId);

    expect(status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toEqual({ nights: 'must be at least 1' });
  });

  it('maps a DomainError to 500 — it means a bug, not bad user input', () => {
    const { status, body } = envelopeFor(
      new DomainError('INVALID_NIGHTS', 'The engine requires at least one night.', { nights: 0 }),
      requestId,
    );

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL');
    // The specific domain message goes to the log, not to the client.
    expect(body.error.message).not.toContain('at least one night');
  });

  it('never leaks a stack trace, a message, or internal details from an unknown error', () => {
    const leaky = new Error('connect ECONNREFUSED 10.0.0.5:5432 (password=hunter2)');
    const { status, body } = envelopeFor(leaky, requestId);

    expect(status).toBe(500);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('ECONNREFUSED');
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('10.0.0.5');
    expect(serialised).not.toContain('stack');
  });

  it('always returns the request id so a user can quote one string', () => {
    for (const thrown of [
      ApiError.notFound(),
      new Error('x'),
      new DomainError('X', 'y'),
      z.string().safeParse(1).error,
    ]) {
      expect(envelopeFor(thrown, requestId).body.error.requestId).toBe(requestId);
    }
  });

  it('produces a body matching the §5.1 shape for every branch', () => {
    for (const thrown of [ApiError.forbidden(), new Error('x'), new DomainError('X', 'y')]) {
      const { body } = envelopeFor(thrown, requestId);
      expect(body).toHaveProperty('error.code');
      expect(body).toHaveProperty('error.message');
      expect(Object.keys(body)).toEqual(['error']);
    }
  });
});
