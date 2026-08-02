'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Card,
  CurrencyInput,
  Disclosure,
  EmptyState,
  Input,
  NumberInput,
  Select,
  StatTile,
  Toggle,
  useToast,
} from '@/components/ui';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { CHANNEL_DEFINITIONS } from '@/domain/rules/channels.rules';
import type { CardKind } from '@/domain/rules/price-match.rules';
import { countChangedWinners, type SavedComparisonSummary } from './sensitivity';
import { addCard, removeCard, setCardActive, updateUserSettings } from './actions';
import { CARD_KIND_LABELS, CARD_KIND_VALUES, type CardView, type UserSettingsView } from './types';
import { AccountDataSection } from './AccountDataSection';

/**
 * `/settings` — §7.8.
 *
 * "Point valuations with a live 'at this valuation, N of your saved
 * comparisons change winner' readout — this is the honesty feature and it is
 * worth the query." That readout (`countChangedWinners`, from
 * `./sensitivity`) recomputes on every keystroke against the comparisons
 * already loaded server-side; nothing about dragging the MR/UR inputs touches
 * the network, which is what makes it feel live rather than debounced.
 */

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
  { value: 'CHF', label: 'CHF — Swiss Franc' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'HKD', label: 'HKD — Hong Kong Dollar' },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'UTC', label: 'UTC' },
];

const CARD_KIND_OPTIONS = CARD_KIND_VALUES.map((kind) => ({ value: kind, label: CARD_KIND_LABELS[kind] }));

export interface SettingsScreenProps {
  readonly initialSettings: UserSettingsView;
  readonly initialCards: readonly CardView[];
  readonly comparisons: readonly SavedComparisonSummary[];
  readonly signedIn: boolean;
  /** The address that authenticates — §12's deletion flow confirms against it. */
  readonly accountEmail: string;
}

export function SettingsScreen({
  initialSettings,
  initialCards,
  comparisons,
  signedIn,
  accountEmail,
}: SettingsScreenProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [mrValueMicro, setMrValueMicro] = React.useState(initialSettings.mrValueMicro);
  const [urValueMicro, setUrValueMicro] = React.useState(initialSettings.urValueMicro);
  const [breakfastPerDayCents, setBreakfastPerDayCents] = React.useState<number | null>(
    initialSettings.breakfastPerDayCents,
  );
  const [foraRateBps, setForaRateBps] = React.useState(initialSettings.foraRateBps);
  const [foraMember, setForaMember] = React.useState(initialSettings.foraMember);
  const [cardmemberAnniversary, setCardmemberAnniversary] = React.useState(
    initialSettings.cardmemberAnniversary ?? '',
  );
  const [homeCurrency, setHomeCurrency] = React.useState(initialSettings.homeCurrency);
  const [timezone, setTimezone] = React.useState(initialSettings.timezone);

  const [saving, startSaving] = React.useTransition();
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // §7.8's readout: pure, synchronous, and re-derived on every valuation
  // keystroke — no network round trip, which is what makes it feel live.
  const sensitivity = React.useMemo(
    () => countChangedWinners(comparisons, mrValueMicro, urValueMicro),
    [comparisons, mrValueMicro, urValueMicro],
  );

  const handleSave = () => {
    setSaveError(null);
    startSaving(async () => {
      const result = await updateUserSettings({
        mrValueMicro,
        urValueMicro,
        breakfastPerDayCents: breakfastPerDayCents ?? 0,
        foraRateBps,
        foraMember,
        cardmemberAnniversary: cardmemberAnniversary === '' ? null : cardmemberAnniversary,
        homeCurrency,
        timezone,
      });

      if (result.ok) {
        toast({ title: 'Settings saved', variant: 'success' });
        router.refresh();
      } else {
        setSaveError(result.message);
        toast({ title: 'Could not save settings', description: result.message, variant: 'error' });
      }
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-6 p-4 lg:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary">
          Point valuations, cards, and the assumptions the comparator uses on every stay.
        </p>
        {!signedIn ? (
          <p className="text-xs text-status-warning">
            You are not signed in. You can try every control below, but nothing will be saved.
          </p>
        ) : null}
      </header>

      {/* ----------------------------------------------------- point valuations */}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 text-text-primary">Point valuations</h2>
          {/* §2.5: "the most contestable assumption in the model." */}
          <p className="text-sm text-text-secondary">
            What one Membership Rewards or Ultimate Rewards point is worth to you. Every
            comparison, past and future, is ranked using these numbers.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput
            label="Membership Rewards value (micro-cents)"
            value={mrValueMicro}
            onChange={(value) => setMrValueMicro(Math.max(0, value ?? 0))}
            min={0}
            step={500}
            hint="15000 = 1.5¢ per point"
          />
          <NumberInput
            label="Ultimate Rewards value (micro-cents)"
            value={urValueMicro}
            onChange={(value) => setUrValueMicro(Math.max(0, value ?? 0))}
            min={0}
            step={500}
            hint="17500 = 1.75¢ per point"
          />
        </div>

        {/* -------------------------------------------- the honesty feature */}
        {comparisons.length === 0 ? (
          <StatTile
            label="Valuation sensitivity"
            value="0 of 0"
            sublabel="You haven't saved any comparisons yet — once you do, this will show how many change winner at this valuation."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <StatTile
              label="Valuation sensitivity"
              value={`${sensitivity.changed} of ${sensitivity.total}`}
              sublabel="saved comparisons would change winner at this valuation"
              delta={
                sensitivity.changed > 0
                  ? { label: `${sensitivity.changed} would flip`, direction: 'up', sentiment: 'bad' }
                  : { label: 'None would flip', direction: 'flat', sentiment: 'good' }
              }
            />
            {sensitivity.changed > 0 ? (
              <Disclosure summary={`Which ${sensitivity.changed} would flip?`}>
                <ul className="flex flex-col gap-1">
                  {sensitivity.changedComparisons.map((change) => (
                    <li key={change.id} className="text-xs text-text-secondary">
                      <span className="font-medium text-text-primary">{change.propertyLabel}</span>:{' '}
                      {change.from ? CHANNEL_DEFINITIONS[change.from].label : '—'} →{' '}
                      {change.to ? CHANNEL_DEFINITIONS[change.to].label : '—'}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : null}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- perks & fees */}
      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 text-text-primary">Perks &amp; fees</h2>
        <CurrencyInput
          label="Breakfast per day"
          value={breakfastPerDayCents}
          onChange={setBreakfastPerDayCents}
          hint="What you would otherwise have paid, not the menu price — §2.6."
        />
        <NumberInput
          label="Fora commission (bps)"
          value={foraRateBps}
          onChange={(value) => setForaRateBps(Math.max(0, Math.min(10_000, value ?? 0)))}
          min={0}
          max={10_000}
          hint="700 = 7%. Arrives weeks later as a post-stay rebate, not a discount at booking."
        />
        <Toggle
          label="Fora membership active"
          checked={foraMember}
          onCheckedChange={setForaMember}
          description="$99/quarter or $299/year. Fora bookings cannot use portal statement credits."
        />
      </Card>

      {/* -------------------------------------------------------------- cards */}
      <CardsSection cards={initialCards} signedIn={signedIn} onChanged={() => router.refresh()} />

      {/* §12 requires data export and deletion to both work from /settings. */}
      <AccountDataSection email={accountEmail} signedIn={signedIn} />

      {/* ------------------------------------------------------------ profile */}
      <Card className="flex flex-col gap-4">
        <h2 className="text-h3 text-text-primary">Profile</h2>
        <Input
          type="date"
          label="Cardmember anniversary"
          value={cardmemberAnniversary}
          onChange={(event) => setCardmemberAnniversary(event.target.value)}
          hint="Sets the window for the Sapphire Reserve $300 broad-travel credit — §2.4."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Timezone" value={timezone} onChange={setTimezone} options={TIMEZONE_OPTIONS} />
          <Select label="Currency" value={homeCurrency} onChange={setHomeCurrency} options={CURRENCY_OPTIONS} />
        </div>
      </Card>

      {/* --------------------------------------------------------- appearance */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-h3 text-text-primary">Appearance</h2>
        <ThemeToggle className="max-w-xs" />
      </Card>

      <div className="flex flex-col items-start gap-2">
        <Button variant="primary" loading={saving} onClick={handleSave}>
          Save settings
        </Button>
        {saveError ? (
          <p role="alert" className="text-sm text-status-critical">
            {saveError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- CardsSection */

function CardsSection({
  cards,
  signedIn,
  onChanged,
}: {
  cards: readonly CardView[];
  signedIn: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [newKind, setNewKind] = React.useState<CardKind>(CARD_KIND_VALUES[0]);
  const [newNickname, setNewNickname] = React.useState('');
  const [pending, startPending] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleAdd = () => {
    setError(null);
    startPending(async () => {
      const result = await addCard({ kind: newKind, nickname: newNickname.trim() || undefined });
      if (result.ok) {
        setAdding(false);
        setNewNickname('');
        toast({ title: 'Card added', variant: 'success' });
        onChanged();
      } else {
        setError(result.message);
      }
    });
  };

  const handleToggleActive = (card: CardView) => {
    startPending(async () => {
      const result = await setCardActive(card.id, !card.active);
      if (result.ok) onChanged();
      else toast({ title: 'Could not update card', description: result.message, variant: 'error' });
    });
  };

  const handleRemove = (card: CardView) => {
    startPending(async () => {
      const result = await removeCard(card.id);
      if (result.ok) {
        toast({ title: 'Card removed', variant: 'info' });
        onChanged();
      } else {
        toast({ title: 'Could not remove card', description: result.message, variant: 'error' });
      }
    });
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 text-text-primary">Cards</h2>
        <Button variant="secondary" size="sm" disabled={!signedIn} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add card'}
        </Button>
      </div>

      {cards.length === 0 && !adding ? (
        <EmptyState
          message="No cards added yet."
          action={signedIn ? { label: 'Add card', onClick: () => setAdding(true) } : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-text-primary">{CARD_KIND_LABELS[card.kind]}</p>
                {card.nickname ? <p className="text-xs text-text-muted">{card.nickname}</p> : null}
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  label="Active"
                  checked={card.active}
                  onCheckedChange={() => handleToggleActive(card)}
                  disabled={pending}
                />
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleRemove(card)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <Select
            label="Card"
            value={newKind}
            onChange={(value) => setNewKind(value as CardKind)}
            options={CARD_KIND_OPTIONS}
          />
          <Input
            label="Nickname"
            value={newNickname}
            onChange={(event) => setNewNickname(event.target.value)}
            placeholder="Optional"
          />
          {error ? (
            <p role="alert" className="text-xs text-status-critical">
              {error}
            </p>
          ) : null}
          <Button variant="secondary" size="sm" loading={pending} onClick={handleAdd}>
            Add
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
