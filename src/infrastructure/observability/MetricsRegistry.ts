/**
 * In-process metrics — counters, gauges and latency histograms.
 *
 * §12 rules out a third-party telemetry vendor: "the app knows what hotels the
 * user is considering; treat that as sensitive", and a vendor SDK is the same
 * category of risk as a tracking pixel. So metrics live in the process and are
 * *pulled* from `/api/metrics` rather than pushed anywhere. No data leaves the
 * deployment. See DECISIONS.md D-042.
 *
 * Quantiles are computed from a bounded ring buffer of recent samples rather
 * than from fixed buckets. For one user's traffic that is both exact and
 * cheaper than maintaining bucket boundaries, and it means the p95 in
 * `/api/metrics` is a real p95 — which matters, because §5.3 sets a p95 budget
 * of 100 ms for `POST /api/compare` and DECISIONS.md D-043 makes that budget a
 * test rather than an aspiration.
 */

export type MetricLabels = Readonly<Record<string, string>>;

export interface HistogramSnapshot {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSnapshot>>;
  readonly collectedAt: string;
}

export interface Metrics {
  increment(name: string, labels?: MetricLabels, by?: number): void;
  gauge(name: string, value: number, labels?: MetricLabels): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  /** Times `fn`, records the duration, and records success/failure counters. */
  time<T>(name: string, fn: () => Promise<T>, labels?: MetricLabels): Promise<T>;
  snapshot(): MetricsSnapshot;
}

/** Default sample capacity per histogram series. */
const DEFAULT_CAPACITY = 2_048;

/**
 * A fixed-capacity ring of recent observations. Old samples fall off the back,
 * so a long-running process reports *recent* latency rather than a lifetime
 * average that hides a regression.
 */
class Reservoir {
  private readonly samples: Float64Array;
  private cursor = 0;
  private filled = 0;
  private total = 0;
  private minimum = Number.POSITIVE_INFINITY;
  private maximum = Number.NEGATIVE_INFINITY;
  private lifetimeCount = 0;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
    this.samples = new Float64Array(capacity);
  }

  public observe(value: number): void {
    this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
    this.lifetimeCount += 1;
    this.total += value;
    if (value < this.minimum) this.minimum = value;
    if (value > this.maximum) this.maximum = value;
  }

  public snapshot(): HistogramSnapshot {
    if (this.filled === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = Array.from(this.samples.subarray(0, this.filled)).sort((a, b) => a - b);

    return {
      count: this.lifetimeCount,
      sum: this.total,
      min: this.minimum,
      max: this.maximum,
      mean: this.total / this.lifetimeCount,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
    };
  }
}

/**
 * Nearest-rank quantile. Chosen over linear interpolation because an
 * interpolated p95 can report a latency that never actually occurred, and the
 * point of a latency budget is to reason about observed requests.
 */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(q * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

/** Renders `name{label="value",…}` with labels sorted, so a series key is stable. */
export function seriesKey(name: string, labels?: MetricLabels): string {
  if (!labels) return name;
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return name;
  const rendered = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
    .join(',');
  return `${name}{${rendered}}`;
}

export interface MetricsRegistryOptions {
  readonly capacity?: number;
  /** Monotonic milliseconds. Injected so tests are deterministic. */
  readonly now?: () => number;
  readonly enabled?: boolean;
}

export class MetricsRegistry implements Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, Reservoir>();
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly enabled: boolean;

  constructor(options: MetricsRegistryOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.now = options.now ?? (() => performance.now());
    this.enabled = options.enabled ?? true;
  }

  public increment(name: string, labels?: MetricLabels, by = 1): void {
    if (!this.enabled) return;
    const key = seriesKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  public gauge(name: string, value: number, labels?: MetricLabels): void {
    if (!this.enabled) return;
    this.gauges.set(seriesKey(name, labels), value);
  }

  public observe(name: string, value: number, labels?: MetricLabels): void {
    if (!this.enabled) return;
    const key = seriesKey(name, labels);
    let reservoir = this.histograms.get(key);
    if (!reservoir) {
      reservoir = new Reservoir(this.capacity);
      this.histograms.set(key, reservoir);
    }
    reservoir.observe(value);
  }

  /**
   * Times `fn` and records the duration under `name`, plus an outcome counter.
   *
   * The duration is recorded on the failure path too. A use case that is slow
   * *because* it is failing is exactly the case you want in the histogram, and
   * dropping those samples makes an incident look like a latency improvement.
   */
  public async time<T>(name: string, fn: () => Promise<T>, labels?: MetricLabels): Promise<T> {
    const start = this.now();
    try {
      const value = await fn();
      this.observe(name, this.now() - start, labels);
      this.increment(`${name}.outcome`, { ...labels, outcome: 'success' });
      return value;
    } catch (error) {
      this.observe(name, this.now() - start, labels);
      this.increment(`${name}.outcome`, { ...labels, outcome: 'failure' });
      throw error;
    }
  }

  public snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        [...this.histograms].map(([key, reservoir]) => [key, reservoir.snapshot()]),
      ),
      collectedAt: new Date().toISOString(),
    };
  }

  /** Prometheus text exposition, so a future scraper needs no adapter. */
  public toPrometheus(): string {
    const lines: string[] = [];

    for (const [key, value] of this.counters) {
      lines.push(`${toPromName(key)} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      lines.push(`${toPromName(key)} ${value}`);
    }
    for (const [key, reservoir] of this.histograms) {
      const stats = reservoir.snapshot();
      const base = toPromName(key);
      const withQuantile = (q: string, value: number) =>
        base.includes('{')
          ? `${base.slice(0, -1)},quantile="${q}"} ${value}`
          : `${base}{quantile="${q}"} ${value}`;
      lines.push(withQuantile('0.5', stats.p50));
      lines.push(withQuantile('0.95', stats.p95));
      lines.push(withQuantile('0.99', stats.p99));
      lines.push(`${stripLabels(base)}_count${labelsOf(base)} ${stats.count}`);
      lines.push(`${stripLabels(base)}_sum${labelsOf(base)} ${stats.sum}`);
    }

    return `${lines.join('\n')}\n`;
  }

  public reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

function toPromName(key: string): string {
  const braceAt = key.indexOf('{');
  if (braceAt === -1) return key.replace(/[.-]/g, '_');
  return `${key.slice(0, braceAt).replace(/[.-]/g, '_')}${key.slice(braceAt)}`;
}

function stripLabels(key: string): string {
  const braceAt = key.indexOf('{');
  return braceAt === -1 ? key : key.slice(0, braceAt);
}

function labelsOf(key: string): string {
  const braceAt = key.indexOf('{');
  return braceAt === -1 ? '' : key.slice(braceAt);
}

/** Discards everything. For tests that don't assert on metrics. */
export const NULL_METRICS: Metrics = Object.freeze({
  increment: () => undefined,
  gauge: () => undefined,
  observe: () => undefined,
  time: <T>(_name: string, fn: () => Promise<T>) => fn(),
  snapshot: () => ({ counters: {}, gauges: {}, histograms: {}, collectedAt: '' }),
});

/**
 * The process-wide registry.
 *
 * A module-level singleton is correct here: metrics describe *this* process, so
 * one instance per process is the semantics, and the alternative — threading a
 * registry through every constructor — buys nothing.
 */
export const metrics = new MetricsRegistry({
  enabled: process.env.METRICS_ENABLED !== 'false',
});
