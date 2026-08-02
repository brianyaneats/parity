'use client';

import { useState } from 'react';
import { Button, Disclosure, Select } from '@/components/ui';
import { CHANNEL_DEFINITIONS, CHANNEL_RANK_ORDER, type Channel } from '@/domain/rules/channels.rules';
import { formatCents } from '@/lib/format';
import {
  parseRatePaste,
  isParseUseful,
  type ParsedRate,
  type ParseConfidence,
} from '@/domain/parsing/rate-paste-parser';

/**
 * The paste parser's UI — §13.3.
 *
 * "**Input friction is the existential risk.** The engine can be flawless and
 * the app still dies because entering six rates on a phone before booking is
 * too much work."
 *
 * Two rules govern this component and neither is negotiable:
 *
 * 1. **The parse is deterministic regex, never an LLM** (§1.4). All the work
 *    happens in `@/domain/parsing/rate-paste-parser`, which is pure, tested,
 *    and has no network access of any kind.
 * 2. **Always show the parsed result for confirmation before it touches the
 *    engine.** Nothing is applied until the user presses Apply, every field
 *    shows the text it was derived from, and a field the parser could not read
 *    is listed as missing rather than filled with a plausible guess.
 *
 * It is an inline expansion, not a modal — §0.5 bans "any modal that could have
 * been an inline expansion."
 */

const CHANNEL_OPTIONS = CHANNEL_RANK_ORDER.map((channel) => ({
  value: channel,
  label: CHANNEL_DEFINITIONS[channel].label,
}));

export interface PasteRateBlockProps {
  /**
   * Applied only on explicit confirmation, with the channel the user chose.
   *
   * The channel is a separate argument rather than a field on `ParsedRate`
   * because the parser genuinely cannot know it: a rate block is just numbers
   * and dates, and nothing in it reliably says "this came from The Edit". An
   * earlier version defaulted every applied row to `EDIT`, which silently
   * granted 8× Ultimate Rewards, price-match eligibility and a $250 statement
   * credit to a pasted Marriott.com or Expedia rate. The user picks.
   */
  readonly onApply: (parsed: ParsedRate, channel: Channel) => void;
  /** Used to resolve a date written without a year. */
  readonly assumeYear?: number;
  /** The engine is single-currency (§3.2 has no currency on `StayContext`). */
  readonly homeCurrency?: string;
}

export function PasteRateBlock({
  onApply,
  assumeYear,
  homeCurrency = 'USD',
}: PasteRateBlockProps) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedRate | null>(null);
  const [channel, setChannel] = useState<string | undefined>(undefined);

  const handleParse = (next: string) => {
    setText(next);
    setParsed(next.trim().length > 0 ? parseRatePaste(next, assumeYear) : null);
  };

  const useful = parsed !== null && isParseUseful(parsed);

  /**
   * A foreign-currency paste is refused outright rather than applied.
   *
   * The parser correctly reads `¥40,000` as 40,000 minor units — but
   * `StayContext` carries no currency (§3.2), so every figure downstream is
   * rendered and compared as dollars. Applying it would turn a ¥40,000 Tokyo
   * rate into a confident "$400.00", roughly 50% under the real value, with no
   * warning. Tokyo, London and Paris are three of the six seeded cities, so
   * this is the normal case abroad, not an edge case.
   *
   * Refusing is the conservative option §0.3 asks for: the user converts and
   * re-pastes, which is a minute of work, rather than booking against a number
   * that is wrong by a third.
   */
  const foreignCurrency =
    parsed?.currency && parsed.currency.value !== homeCurrency ? parsed.currency.value : null;

  return (
    <Disclosure summary="Paste a rate block">
      <div className="flex flex-col gap-3 pt-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">
            Copy the rate details from the booking page and paste them here.
          </span>
          <textarea
            value={text}
            onChange={(event) => handleParse(event.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full rounded-md border border-border bg-surface-1 p-2 font-mono text-sm text-text-primary placeholder:text-text-muted"
            placeholder={'Check-in: September 1, 2026\nTotal: $3,540.00\nFree cancellation'}
          />
        </label>

        {parsed !== null && !useful ? (
          <p className="text-sm text-text-muted">
            Nothing recognisable yet — a rate block needs at least a total or a room rate.
          </p>
        ) : null}

        {useful && parsed ? (
          <>
            <div className="rounded-md border border-border p-3">
              <p className="text-label text-text-muted">WHAT WAS READ</p>
              <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Row
                  label="Total incl. tax"
                  value={parsed.totalCents ? formatCents(parsed.totalCents.value) : null}
                  from={parsed.totalCents?.matchedText}
                  confidence={parsed.totalCents?.confidence}
                />
                <Row
                  label="Base rate"
                  value={parsed.baseCents ? formatCents(parsed.baseCents.value) : null}
                  from={parsed.baseCents?.matchedText}
                  confidence={parsed.baseCents?.confidence}
                />
                <Row
                  label="Tax"
                  value={parsed.taxCents ? formatCents(parsed.taxCents.value) : null}
                  from={parsed.taxCents?.matchedText}
                  confidence={parsed.taxCents?.confidence}
                />
                <Row
                  label="Nights"
                  value={parsed.nights ? String(parsed.nights.value) : null}
                  from={parsed.nights?.matchedText}
                  confidence={parsed.nights?.confidence}
                />
                <Row
                  label="Check-in"
                  value={parsed.checkIn?.value ?? null}
                  from={parsed.checkIn?.matchedText}
                  confidence={parsed.checkIn?.confidence}
                />
                <Row
                  label="Check-out"
                  value={parsed.checkOut?.value ?? null}
                  from={parsed.checkOut?.matchedText}
                  confidence={parsed.checkOut?.confidence}
                />
                <Row
                  label="Room"
                  value={parsed.roomType?.value ?? null}
                  from={parsed.roomType?.matchedText}
                  confidence={parsed.roomType?.confidence}
                />
                <Row
                  label="Cancellation"
                  value={
                    parsed.refundable
                      ? parsed.refundable.value
                        ? 'Refundable'
                        : 'Non-refundable'
                      : null
                  }
                  from={parsed.refundable?.matchedText}
                  confidence={parsed.refundable?.confidence}
                />
              </dl>

              {parsed.missing.length > 0 ? (
                <p className="mt-3 border-t border-border pt-2 text-sm text-text-secondary">
                  Not found, so you will need to enter {formatList(parsed.missing)} yourself.
                  Nothing here is guessed.
                </p>
              ) : null}
            </div>

            {foreignCurrency ? (
              <p className="rounded-sm border border-status-warning p-2 text-sm text-text-secondary">
                <span aria-hidden="true" className="mr-1 font-mono text-status-warning">
                  ▲
                </span>
                <span className="sr-only">Check: </span>
                This rate is in {foreignCurrency}, and Parity compares everything in{' '}
                {homeCurrency}. Convert it first and paste the {homeCurrency} figure — applying
                it as-is would treat {foreignCurrency} amounts as {homeCurrency} and get the
                ranking wrong by the exchange rate.
              </p>
            ) : (
              <Select
                label="Which channel is this rate from?"
                value={channel}
                onChange={setChannel}
                options={CHANNEL_OPTIONS}
                placeholder="Pick a channel"
                hint="The paste cannot tell us this, and getting it wrong grants perks and credits the booking never earns."
              />
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={foreignCurrency !== null || channel === undefined}
                onClick={() => {
                  if (!channel) return;
                  onApply(parsed, channel as Channel);
                  setText('');
                  setParsed(null);
                  setChannel(undefined);
                }}
              >
                Apply these values
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setText('');
                  setParsed(null);
                }}
              >
                Discard
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Disclosure>
  );
}

function Row({
  label,
  value,
  from,
  confidence,
}: {
  label: string;
  value: string | null;
  from?: string;
  confidence?: ParseConfidence;
}) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="tnum text-sm text-text-primary">
        {value ?? <span className="text-text-muted">Not found</span>}
        {/* A medium-confidence read is one the user should look at twice —
            a currency inferred from a symbol, or nights derived rather than
            stated. Marked in words, never by colour alone (§6.7). */}
        {value && confidence === 'medium' ? (
          <span className="ml-1 text-xs text-text-muted">(check this)</span>
        ) : null}
      </dd>
      {from ? (
        <p className="truncate font-mono text-xs text-text-muted" title={from}>
          from “{from}”
        </p>
      ) : null}
    </div>
  );
}

function formatList(items: readonly string[]): string {
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
