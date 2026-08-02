/**
 * Structured logging.
 *
 * Two constraints shape this:
 *
 * - **§12 treats the user's hotel list as sensitive.** "The app knows what
 *   hotels the user is considering." So there is no third-party log vendor,
 *   and there is a redaction pass that runs on every field before it is
 *   serialised — not as a convention a caller has to remember.
 * - **Logs are JSON, one object per line.** A log line that has to be parsed by
 *   a regex later is a log line that will be parsed wrong.
 *
 * Every log carries a `requestId` so a single user action can be followed
 * across the route handler, the use case, the repository and back — §5.1
 * requires it returned in `X-Request-Id`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
  /** Returns a logger that merges `fields` into every subsequent line. */
  child(fields: LogFields): Logger;
}

/**
 * Field names whose values are replaced with `[redacted]`.
 *
 * §12 forbids storing a card number or CVV anywhere, and confirmation numbers
 * are stored but should not be sprayed through logs. This list is deliberately
 * broader than what the schema can hold: it also catches anything a future
 * caller passes in carelessly.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'cardnumber',
  'cvv',
  'pan',
  'confirmationnumber',
  'email',
]);

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(entry, depth + 1);
    }
    return out;
  }

  return value;
}

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly fields: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

export interface JsonLoggerOptions {
  readonly level?: LogLevel;
  readonly base?: LogFields;
  /** Where lines go. Injected so tests capture rather than print. */
  readonly sink?: LogSink;
  /** Injected so the domain rule "no ambient clock" holds here too. */
  readonly now?: () => Date;
}

export class JsonLogger implements Logger {
  private readonly level: LogLevel;
  private readonly base: LogFields;
  private readonly sink: LogSink;
  private readonly now: () => Date;

  constructor(options: JsonLoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.base = options.base ?? {};
    this.sink = options.sink ?? defaultSink;
    this.now = options.now ?? (() => new Date());
  }

  public debug(message: string, fields: LogFields = {}): void {
    this.write('debug', message, fields);
  }

  public info(message: string, fields: LogFields = {}): void {
    this.write('info', message, fields);
  }

  public warn(message: string, fields: LogFields = {}): void {
    this.write('warn', message, fields);
  }

  public error(message: string, error?: unknown, fields: LogFields = {}): void {
    this.write('error', message, {
      ...fields,
      ...(error === undefined ? {} : { error: serialiseError(error) }),
    });
  }

  public child(fields: LogFields): Logger {
    return new JsonLogger({
      level: this.level,
      base: { ...this.base, ...fields },
      sink: this.sink,
      now: this.now,
    });
  }

  private write(level: LogLevel, message: string, fields: LogFields): void {
    if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[this.level]) return;

    this.sink({
      level,
      message,
      timestamp: this.now().toISOString(),
      fields: redact({ ...this.base, ...fields }) as Record<string, unknown>,
    });
  }
}

/**
 * Preserves the stack for `error` and `warn`, drops it below that. A stack on
 * every debug line makes logs unreadable; a missing stack on an error makes
 * them useless.
 */
function serialiseError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...('code' in error ? { code: (error as { code?: unknown }).code } : {}),
    };
  }
  return { value: String(error) };
}

const defaultSink: LogSink = (record) => {
  const line = JSON.stringify({
    level: record.level,
    time: record.timestamp,
    msg: record.message,
    ...record.fields,
  });
  if (record.level === 'error') console.error(line);
  else if (record.level === 'warn') console.warn(line);
  else console.log(line);
};

/** Collects records instead of printing. For tests and the dev overlay. */
export class MemoryLogger implements Logger {
  public readonly records: LogRecord[] = [];
  private readonly delegate: JsonLogger;

  constructor(options: Omit<JsonLoggerOptions, 'sink'> = {}) {
    this.delegate = new JsonLogger({
      ...options,
      level: options.level ?? 'debug',
      sink: (record) => this.records.push(record),
    });
  }

  public debug(message: string, fields?: LogFields): void {
    this.delegate.debug(message, fields);
  }
  public info(message: string, fields?: LogFields): void {
    this.delegate.info(message, fields);
  }
  public warn(message: string, fields?: LogFields): void {
    this.delegate.warn(message, fields);
  }
  public error(message: string, error?: unknown, fields?: LogFields): void {
    this.delegate.error(message, error, fields);
  }
  public child(fields: LogFields): Logger {
    const scoped = new MemoryLogger();
    // Share the buffer so assertions can read every line from the root.
    Object.defineProperty(scoped, 'records', { value: this.records });
    Object.defineProperty(scoped, 'delegate', {
      value: this.delegate.child(fields),
    });
    return scoped;
  }

  public messages(): string[] {
    return this.records.map((record) => record.message);
  }

  public clear(): void {
    this.records.length = 0;
  }
}

/** A logger that discards everything. For hot paths and for tests that don't care. */
export const NULL_LOGGER: Logger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => NULL_LOGGER,
});

export function createLogger(options: JsonLoggerOptions = {}): Logger {
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  return new JsonLogger({
    ...options,
    level: options.level ?? (envLevel && envLevel in LEVEL_SEVERITY ? envLevel : 'info'),
  });
}
