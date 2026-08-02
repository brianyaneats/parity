/**
 * Optional engine profiling — DECISIONS.md D-041.
 *
 * §3 requires the engine to be pure: no I/O, no ambient clock. That rules out
 * reaching for `performance.now()` inside it. So the profiler *supplies* the
 * timer rather than the engine owning one, and the default implementation reads
 * no clock at all — the disabled path is pure arithmetic and nothing else.
 *
 * A profiler can never change a returned number. It only observes.
 */
export interface EngineProfiler {
  /** Monotonic milliseconds. The caller decides where time comes from. */
  readonly now: () => number;
  readonly record: (step: string, milliseconds: number) => void;
}

/**
 * The default. `now` returns a constant and `record` does nothing, so no clock
 * is read and the whole thing folds away.
 */
export const NULL_PROFILER: EngineProfiler = Object.freeze({
  now: () => 0,
  record: () => undefined,
});

export interface ProfileSample {
  readonly step: string;
  readonly milliseconds: number;
}

/**
 * A profiler that accumulates per-step timings. Used by the dev overlay and by
 * the §5.3 latency budget test, never in a production request path unless
 * explicitly enabled.
 */
export class RecordingProfiler implements EngineProfiler {
  private readonly samples: ProfileSample[] = [];

  constructor(public readonly now: () => number = () => performance.now()) {}

  public readonly record = (step: string, milliseconds: number): void => {
    this.samples.push({ step, milliseconds });
  };

  public get entries(): readonly ProfileSample[] {
    return Object.freeze([...this.samples]);
  }

  /** Total milliseconds per step, summed across calls. */
  public totals(): Readonly<Record<string, number>> {
    const totals: Record<string, number> = {};
    for (const sample of this.samples) {
      totals[sample.step] = (totals[sample.step] ?? 0) + sample.milliseconds;
    }
    return Object.freeze(totals);
  }

  public reset(): void {
    this.samples.length = 0;
  }
}
