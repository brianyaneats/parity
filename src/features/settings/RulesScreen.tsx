'use client';

import * as React from 'react';
import { Badge, DataTable, EmptyState, useToast, type DataTableColumn } from '@/components/ui';
import { formatRuleValue, type RuleView } from '@/domain/rules/registry';
import { RULE_STALENESS_DAYS } from '@/domain/rules/rule-types';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * `/settings/rules` — §7.8, §2.8.
 *
 * "Lists every constant from §2.8 with verified date, source link, and a flag
 * button." The data itself comes from `buildRuleViews` (already built,
 * reused verbatim per the task brief) — this screen's only job is to render
 * it grouped, formatted, and to make the flag action impossible to miss,
 * because §2.8 calls this screen "the entire mitigation for the spec's most
 * perishable assumption": program terms change without notice, and this is
 * the one place the user can tell the app so.
 */

export interface RulesScreenProps {
  readonly views: readonly RuleView[];
}

/** Groups while preserving first-seen order — the registry's own order (§2.2 → §2.7), which is already a sensible reading order. */
function groupByCategory(views: readonly RuleView[]): readonly { categoryLabel: string; rules: readonly RuleView[] }[] {
  const order: string[] = [];
  const groups = new Map<string, RuleView[]>();

  for (const view of views) {
    let bucket = groups.get(view.categoryLabel);
    if (!bucket) {
      bucket = [];
      groups.set(view.categoryLabel, bucket);
      order.push(view.categoryLabel);
    }
    bucket.push(view);
  }

  return order.map((categoryLabel) => ({
    categoryLabel,
    rules: groups.get(categoryLabel) ?? [],
  }));
}

export function RulesScreen({ views }: RulesScreenProps) {
  const groups = React.useMemo(() => groupByCategory(views), [views]);

  const columns: readonly DataTableColumn<RuleView>[] = React.useMemo(
    () => [
      {
        key: 'label',
        header: 'Rule',
        widthClassName: 'w-[34%]',
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-text-primary">{row.label}</p>
            <p className="text-xs text-text-muted">{row.description}</p>
          </div>
        ),
      },
      {
        key: 'value',
        header: 'Value',
        render: (row) => <span className="tnum text-sm text-text-primary">{formatRuleValue(row)}</span>,
      },
      {
        key: 'verified',
        header: 'Last verified',
        render: (row) => (
          <div className="flex flex-col gap-1">
            {/* verifiedOn is a bare calendar date (no time-of-day), so it is
                formatted in UTC rather than the reader's local timezone —
                otherwise a date at UTC midnight reads as the previous evening
                west of Greenwich, an off-by-one that has nothing to do with
                when the rule was actually checked. */}
            <span className="tnum text-sm text-text-secondary">{formatDate(row.verifiedOn, 'UTC')}</span>
            {row.stale ? (
              <Badge variant="warning">Stale · {row.ageDays}d old</Badge>
            ) : (
              <span className="text-xs text-text-muted">{row.ageDays}d ago</span>
            )}
          </div>
        ),
      },
      {
        key: 'source',
        header: 'Source',
        render: (row) => (
          <a
            href={row.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-text-secondary underline-offset-2 hover:underline focus-visible:underline"
          >
            View source
          </a>
        ),
      },
      {
        key: 'flag',
        header: '',
        render: (row) => <FlagButton ruleKey={row.key} label={row.label} />,
      },
    ],
    [],
  );

  if (views.length === 0) {
    // Unreachable with the real registry (`ALL_RULES` is a non-empty compile-
    // time constant) but kept as a real, distinct state per §6.4 rather than
    // an empty table, since a caller could in principle pass a filtered list.
    return <EmptyState message="No rules are registered yet." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 lg:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-text-primary">Rules</h1>
        <p className="max-w-2xl text-sm text-text-secondary">
          Every threshold the engine uses, sourced and dated. Programme terms change without
          notice — if you know one of these is out of date, flag it rather than letting the
          comparator quietly rely on a stale number. Rules older than {RULE_STALENESS_DAYS} days
          are marked stale automatically.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.categoryLabel} aria-label={group.categoryLabel} className="flex flex-col gap-2">
          <h2 className="text-h3 text-text-primary">{group.categoryLabel}</h2>
          <DataTable
            columns={columns}
            rows={group.rules}
            getRowId={(row) => row.key}
            caption={`${group.categoryLabel} rules`}
          />
        </section>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- FlagButton */

type FlagStatus = 'idle' | 'pending' | 'flagged' | 'error';

/**
 * §2.8: "a 'flag as changed' button POSTing to `/api/rules/flag`."
 *
 * That route is not part of this build (it belongs to the API surface, not
 * this feature's owned paths) and may not exist yet. This button is written
 * to degrade honestly rather than pretend: a 404 or network failure is caught
 * and shown inline, never silently swallowed and never presented as success.
 */
function FlagButton({ ruleKey, label }: { ruleKey: string; label: string }) {
  const [status, setStatus] = React.useState<FlagStatus>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const { toast } = useToast();

  const handleFlag = async () => {
    setStatus('pending');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/rules/flag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruleKey }),
      });

      if (!response.ok) {
        throw new Error(response.status === 404 ? 'That endpoint does not exist yet.' : `Server returned ${response.status}.`);
      }

      setStatus('flagged');
      toast({ title: 'Flagged', description: `${label} was marked as changed.`, variant: 'success' });
    } catch (caught) {
      setStatus('error');
      const message = caught instanceof Error ? caught.message : 'Could not reach the server.';
      setErrorMessage(message);
      toast({
        title: "Couldn't flag this rule",
        description: message,
        variant: 'error',
      });
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleFlag()}
        disabled={status === 'pending' || status === 'flagged'}
        aria-label={`Flag "${label}" as changed`}
        className={cn(
          'rounded-md border border-border-strong px-2 py-1 text-xs font-medium',
          'transition-colors duration-fast ease-standard disabled:pointer-events-none',
          status === 'flagged'
            ? 'border-status-good text-status-good'
            : status === 'error'
              ? 'border-status-critical text-status-critical hover:bg-glass-hover'
              : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary',
        )}
      >
        {status === 'pending' ? 'Flagging…' : status === 'flagged' ? 'Flagged' : 'Flag as changed'}
      </button>
      {status === 'error' && errorMessage ? (
        <p role="alert" className="max-w-40 text-right text-xs text-status-critical">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
