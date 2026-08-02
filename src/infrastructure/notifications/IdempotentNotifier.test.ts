import { describe, it, expect } from 'vitest';
import { IdempotentNotifier } from './IdempotentNotifier';
import { FakeNotifier } from '@/application/testing/fakes';
import type { Notifier } from '@/application/ports/Notifier';

const message = (idempotencyKey: string) => ({
  to: 'user@example.com',
  subject: 'Test',
  text: 'Test body',
  idempotencyKey,
});

describe('IdempotentNotifier — §9 "a double-fire cannot double-send"', () => {
  it('sends once for a repeated key, and reports the second call as deduped', async () => {
    const inner = new FakeNotifier();
    const notifier = new IdempotentNotifier(inner);

    const first = await notifier.send(message('k1'));
    const second = await notifier.send(message('k1'));

    expect(first).toEqual({ sent: true, deduped: false });
    expect(second).toEqual({ sent: false, deduped: true });
    expect(inner.sent).toHaveLength(1);
  });

  it('treats distinct keys independently', async () => {
    const inner = new FakeNotifier();
    const notifier = new IdempotentNotifier(inner);

    await notifier.send(message('k1'));
    await notifier.send(message('k2'));

    expect(inner.sent).toHaveLength(2);
  });

  it('expires a key after its TTL, allowing a legitimate re-send later', async () => {
    let clock = 0;
    const inner = new FakeNotifier();
    const notifier = new IdempotentNotifier(inner, 1_000, () => clock);

    await notifier.send(message('k1'));
    clock = 1_001; // just past the 1-second TTL
    const result = await notifier.send(message('k1'));

    expect(result).toEqual({ sent: true, deduped: false });
    expect(inner.sent).toHaveLength(2);
  });

  it('does not call the inner notifier at all on a deduped attempt', async () => {
    let calls = 0;
    const counting: Notifier = {
      send: async () => {
        calls += 1;
        return { sent: true, deduped: false };
      },
    };
    const notifier = new IdempotentNotifier(counting);

    await notifier.send(message('k1'));
    await notifier.send(message('k1'));

    expect(calls).toBe(1);
  });
});
