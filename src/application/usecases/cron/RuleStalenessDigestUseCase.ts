import { staleRules } from '@/domain/rules/registry';
import { ruleAgeDays, RULE_STALENESS_DAYS } from '@/domain/rules/rule-types';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { UserSettingsRepository } from '@/application/ports/UserSettingsRepository';
import type { Notifier } from '@/application/ports/Notifier';
import { isWithinQuietHours } from '@/infrastructure/notifications/quiet-hours';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../../shared/UseCase';

export interface RuleStalenessDigestInput {
  readonly dryRun: boolean;
}

export interface RuleStalenessDigestOutput {
  readonly dryRun: boolean;
  readonly staleRuleCount: number;
  readonly recipients: number;
  readonly notified: number;
  readonly skippedQuietHours: number;
}

/**
 * `rule-staleness` — weekly, Monday 09:00 (§9, §2.8).
 *
 * "Any rule constant with `verifiedOn` older than 180 days produces one
 * digest email listing them." This is a genuinely *recurring* digest, not a
 * one-time notice — a rule that is still stale next week should still be on
 * next week's list — so idempotency here means "at most one digest per
 * recipient per calendar week," not "at most one ever." The idempotency key
 * is keyed on the ISO week (`rule-staleness:{userId}:{isoWeek}`), so a
 * double-fire within the same week is suppressed but next Monday's run is a
 * distinct key and legitimately sends again.
 *
 * There is no per-rule recipient in §4.2's schema — rule constants aren't
 * user-owned — so this notifies every user with a settings row, which is also
 * every user who could plausibly click "flag as changed" on `/settings/rules`.
 *
 * `userId` on the message lets `DurableIdempotentNotifier` durably claim this
 * week's digest key in `notifications_sent`, so a cold start between two
 * invocations on the same Monday cannot re-send it — the same protection
 * `ClaimDeadlineSweepUseCase` needed, via the one shared `Notifier`
 * singleton (`createNotifier.ts`).
 */
export class RuleStalenessDigestUseCase extends CommandUseCase<
  RuleStalenessDigestInput,
  RuleStalenessDigestOutput
> {
  public readonly name = 'rule_staleness_digest';

  constructor(
    deps: UseCaseDependencies,
    private readonly userSettings: UserSettingsRepository,
    private readonly notifier: Notifier,
  ) {
    super(deps);
  }

  protected async handle(
    input: RuleStalenessDigestInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<RuleStalenessDigestOutput> {
    const stale = staleRules(ctx.now);
    if (stale.length === 0) {
      return { dryRun: input.dryRun, staleRuleCount: 0, recipients: 0, notified: 0, skippedQuietHours: 0 };
    }

    const recipients = await this.userSettings.listRecipients();
    const week = isoWeekKey(ctx.now);

    let notified = 0;
    let skippedQuietHours = 0;

    const lines = stale.map(
      (rule) => `- ${rule.label} — verified ${rule.verifiedOn} (${ruleAgeDays(rule, ctx.now)} days ago): ${rule.sourceUrl}`,
    );
    const text =
      `${stale.length} rule constant${stale.length === 1 ? ' has' : 's have'} not been re-verified in over ` +
      `${RULE_STALENESS_DAYS} days:\n\n${lines.join('\n')}\n\n` +
      'Programme terms change without notice — confirm each against its source and flag any that have ' +
      'changed from /settings/rules.';

    for (const recipient of recipients) {
      if (isWithinQuietHours(ctx.now, recipient.timezone)) {
        skippedQuietHours += 1;
        continue;
      }

      const result = await this.notifier.send({
        to: recipient.email,
        subject: `${stale.length} rule constant${stale.length === 1 ? '' : 's'} may be out of date`,
        text,
        idempotencyKey: `rule-staleness:${recipient.userId}:${week}`,
        userId: recipient.userId,
      });

      if (result.sent) notified += 1;
    }

    logger.info('rule-staleness digest complete', {
      dryRun: input.dryRun,
      staleRuleCount: stale.length,
      recipients: recipients.length,
      notified,
      skippedQuietHours,
    });

    return {
      dryRun: input.dryRun,
      staleRuleCount: stale.length,
      recipients: recipients.length,
      notified,
      skippedQuietHours,
    };
  }
}

/** `YYYY-Www` per ISO-8601 week numbering — the digest's own idempotency unit. */
function isoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (day.getUTCDay() + 6) % 7; // Monday = 0 … Sunday = 6
  day.setUTCDate(day.getUTCDate() - dayNumber + 3); // Thursday of the same ISO week

  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
