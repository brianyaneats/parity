import { describe, it, expect, vi } from 'vitest';
import {
  JsonLogger,
  MemoryLogger,
  NULL_LOGGER,
  redact,
  createLogger,
  type LogRecord,
} from './Logger';
import { MetricsRegistry, NULL_METRICS, seriesKey } from './MetricsRegistry';

describe('JsonLogger', () => {
  const capture = () => {
    const records: LogRecord[] = [];
    const logger = new JsonLogger({
      level: 'debug',
      sink: (record) => records.push(record),
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    });
    return { logger, records };
  };

  it('writes one structured record per call with an ISO timestamp', () => {
    const { logger, records } = capture();
    logger.info('comparison computed', { winner: 'EDIT' });

    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('info');
    expect(records[0]?.message).toBe('comparison computed');
    expect(records[0]?.timestamp).toBe('2026-07-27T12:00:00.000Z');
    expect(records[0]?.fields).toMatchObject({ winner: 'EDIT' });
  });

  it('suppresses records below the configured level', () => {
    const records: LogRecord[] = [];
    const logger = new JsonLogger({ level: 'warn', sink: (r) => records.push(r) });

    logger.debug('noise');
    logger.info('noise');
    logger.warn('signal');
    logger.error('signal');

    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('merges child fields into every subsequent line', () => {
    const { logger, records } = capture();
    logger.child({ requestId: 'req-1', useCase: 'compare_channels' }).info('started');

    expect(records[0]?.fields).toMatchObject({
      requestId: 'req-1',
      useCase: 'compare_channels',
    });
  });

  it('keeps the stack on an error so an incident is diagnosable', () => {
    const { logger, records } = capture();
    logger.error('use case failed', new Error('boom'));

    const error = records[0]?.fields.error as Record<string, unknown>;
    expect(error.name).toBe('Error');
    expect(error.message).toBe('boom');
    expect(String(error.stack)).toContain('boom');
  });

  it('serialises a non-Error throwable rather than dropping it', () => {
    const { logger, records } = capture();
    logger.error('odd failure', 'a string was thrown');

    expect(records[0]?.fields.error).toEqual({ value: 'a string was thrown' });
  });

  it('reads the level from LOG_LEVEL and ignores a bogus value', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    expect(createLogger()).toBeInstanceOf(JsonLogger);
    vi.stubEnv('LOG_LEVEL', 'not-a-level');
    expect(createLogger()).toBeInstanceOf(JsonLogger);
    vi.unstubAllEnvs();
  });
});

/**
 * §12 requires PII minimisation and treats the user's hotel list as sensitive.
 * Redaction runs on every field automatically rather than being something each
 * caller has to remember, because the one caller who forgets is the one that
 * matters.
 */
describe('log redaction — §12', () => {
  it('replaces sensitive values regardless of key casing', () => {
    expect(redact({ password: 'hunter2', Token: 'abc', CVV: '123' })).toEqual({
      password: '[redacted]',
      Token: '[redacted]',
      CVV: '[redacted]',
    });
  });

  it('redacts confirmation numbers and email addresses', () => {
    expect(redact({ confirmationNumber: 'XYZ123', email: 'a@b.com' })).toEqual({
      confirmationNumber: '[redacted]',
      email: '[redacted]',
    });
  });

  it('redacts through nested objects and arrays', () => {
    expect(redact({ booking: { secret: 's', channel: 'EDIT' }, list: [{ apiKey: 'k' }] })).toEqual({
      booking: { secret: '[redacted]', channel: 'EDIT' },
      list: [{ apiKey: '[redacted]' }],
    });
  });

  it('leaves ordinary values alone', () => {
    expect(redact({ channel: 'EDIT', nights: 3, ok: true, missing: null })).toEqual({
      channel: 'EDIT',
      nights: 3,
      ok: true,
      missing: null,
    });
  });

  it('normalises Errors and Dates instead of emitting an empty object', () => {
    expect(redact(new Error('x'))).toEqual({ name: 'Error', message: 'x' });
    expect(redact(new Date('2026-07-27T00:00:00Z'))).toBe('2026-07-27T00:00:00.000Z');
  });

  it('truncates a cyclic or pathologically deep structure rather than hanging', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});

describe('MemoryLogger', () => {
  it('collects records and shares the buffer with its children', () => {
    const logger = new MemoryLogger();
    logger.info('root');
    logger.child({ scope: 'child' }).warn('nested');

    expect(logger.messages()).toEqual(['root', 'nested']);
    logger.clear();
    expect(logger.records).toEqual([]);
  });

  it('captures errors through the child logger too', () => {
    const logger = new MemoryLogger();
    const child = logger.child({ a: 1 });
    child.debug('d');
    child.error('e', new Error('x'));
    expect(logger.messages()).toEqual(['d', 'e']);
  });
});

describe('NULL_LOGGER', () => {
  it('discards everything and returns itself from child', () => {
    expect(NULL_LOGGER.child({})).toBe(NULL_LOGGER);
    expect(NULL_LOGGER.info('x')).toBeUndefined();
    expect(NULL_LOGGER.debug('x')).toBeUndefined();
    expect(NULL_LOGGER.warn('x')).toBeUndefined();
    expect(NULL_LOGGER.error('x')).toBeUndefined();
  });
});

describe('seriesKey', () => {
  it('returns the bare name when there are no labels', () => {
    expect(seriesKey('http.requests')).toBe('http.requests');
    expect(seriesKey('http.requests', {})).toBe('http.requests');
  });

  it('sorts labels so the same series always produces the same key', () => {
    expect(seriesKey('m', { b: '2', a: '1' })).toBe(seriesKey('m', { a: '1', b: '2' }));
    expect(seriesKey('m', { b: '2', a: '1' })).toBe('m{a="1",b="2"}');
  });

  it('escapes a quote inside a label value', () => {
    expect(seriesKey('m', { name: 'a"b' })).toBe('m{name="a\\"b"}');
  });
});

describe('MetricsRegistry', () => {
  const registry = (now: () => number = () => 0) => new MetricsRegistry({ now });

  it('accumulates counters per label set', () => {
    const m = registry();
    m.increment('compare.winner', { channel: 'EDIT' });
    m.increment('compare.winner', { channel: 'EDIT' });
    m.increment('compare.winner', { channel: 'FHR' });

    const { counters } = m.snapshot();
    expect(counters['compare.winner{channel="EDIT"}']).toBe(2);
    expect(counters['compare.winner{channel="FHR"}']).toBe(1);
  });

  it('increments by an explicit amount', () => {
    const m = registry();
    m.increment('domain.events_published', undefined, 3);
    expect(m.snapshot().counters['domain.events_published']).toBe(3);
  });

  it('overwrites a gauge rather than accumulating it', () => {
    const m = registry();
    m.gauge('buckets.remaining_cents', 30_000);
    m.gauge('buckets.remaining_cents', 25_000);
    expect(m.snapshot().gauges['buckets.remaining_cents']).toBe(25_000);
  });

  it('computes exact nearest-rank quantiles', () => {
    const m = registry();
    for (let i = 1; i <= 100; i += 1) m.observe('usecase.duration_ms', i);

    const stats = m.snapshot().histograms['usecase.duration_ms'];
    expect(stats?.count).toBe(100);
    expect(stats?.min).toBe(1);
    expect(stats?.max).toBe(100);
    expect(stats?.p50).toBe(50);
    expect(stats?.p95).toBe(95);
    expect(stats?.p99).toBe(99);
    expect(stats?.mean).toBeCloseTo(50.5, 5);
  });

  it('reports zeroes for a histogram that has never been observed', () => {
    const m = registry();
    m.observe('x', 1);
    const snapshot = m.snapshot();
    expect(snapshot.histograms['never']).toBeUndefined();
    expect(snapshot.histograms['x']?.p95).toBe(1);
  });

  it('keeps only the most recent samples so a regression is not diluted', () => {
    // Capacity 4: the first four slow samples fall off, leaving only fast ones.
    const m = new MetricsRegistry({ capacity: 4, now: () => 0 });
    for (const value of [500, 500, 500, 500, 1, 1, 1, 1]) m.observe('lat', value);

    const stats = m.snapshot().histograms['lat'];
    expect(stats?.p95).toBe(1);
    // Lifetime count and min/max are still cumulative, so nothing is lost.
    expect(stats?.count).toBe(8);
    expect(stats?.max).toBe(500);
  });

  it('times a successful call and records a success outcome', async () => {
    let clock = 0;
    const m = new MetricsRegistry({ now: () => (clock += 25) });

    await expect(m.time('usecase.duration_ms', async () => 'done')).resolves.toBe('done');

    const snapshot = m.snapshot();
    expect(snapshot.histograms['usecase.duration_ms']?.count).toBe(1);
    expect(snapshot.counters['usecase.duration_ms.outcome{outcome="success"}']).toBe(1);
  });

  it('still records the duration when the call throws', async () => {
    // A use case that is slow *because* it is failing is exactly the sample you
    // want; dropping it makes an incident look like a latency improvement.
    let clock = 0;
    const m = new MetricsRegistry({ now: () => (clock += 40) });

    await expect(
      m.time('usecase.duration_ms', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const snapshot = m.snapshot();
    expect(snapshot.histograms['usecase.duration_ms']?.count).toBe(1);
    expect(snapshot.counters['usecase.duration_ms.outcome{outcome="failure"}']).toBe(1);
  });

  it('records nothing when disabled', () => {
    const m = new MetricsRegistry({ enabled: false });
    m.increment('a');
    m.gauge('b', 1);
    m.observe('c', 1);

    const snapshot = m.snapshot();
    expect(snapshot.counters).toEqual({});
    expect(snapshot.gauges).toEqual({});
    expect(snapshot.histograms).toEqual({});
  });

  it('clears everything on reset', () => {
    const m = registry();
    m.increment('a');
    m.gauge('b', 1);
    m.observe('c', 1);
    m.reset();

    const snapshot = m.snapshot();
    expect(snapshot.counters).toEqual({});
    expect(snapshot.gauges).toEqual({});
    expect(snapshot.histograms).toEqual({});
  });

  it('emits Prometheus exposition with quantiles, count and sum', () => {
    const m = registry();
    m.increment('http.requests', { route: '/api/compare', status: '200' });
    m.gauge('buckets.remaining', 500);
    m.observe('http.duration_ms', 10, { route: '/api/compare' });

    const text = m.toPrometheus();
    expect(text).toContain('http_requests{route="/api/compare",status="200"} 1');
    expect(text).toContain('buckets_remaining 500');
    expect(text).toContain('quantile="0.95"');
    expect(text).toContain('http_duration_ms_count{route="/api/compare"}');
    expect(text).toContain('http_duration_ms_sum{route="/api/compare"}');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('emits unlabelled histograms without a stray brace', () => {
    const m = registry();
    m.observe('engine_ms', 5);
    const text = m.toPrometheus();
    expect(text).toContain('engine_ms{quantile="0.5"} 5');
    expect(text).toContain('engine_ms_count 1');
  });
});

describe('NULL_METRICS', () => {
  it('discards everything but still runs the timed function', async () => {
    NULL_METRICS.increment('a');
    NULL_METRICS.gauge('b', 1);
    NULL_METRICS.observe('c', 1);
    await expect(NULL_METRICS.time('d', async () => 7)).resolves.toBe(7);
    expect(NULL_METRICS.snapshot().counters).toEqual({});
  });
});
