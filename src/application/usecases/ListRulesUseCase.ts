import type { Logger } from '@/infrastructure/observability/Logger';
import { buildRuleViews, type RuleView } from '@/domain/rules/registry';
import { QueryUseCase, type ExecutionContext } from '../shared/UseCase';

export interface ListRulesInput {
  readonly userId: string;
}

/**
 * `GET /api/rules` — §5.2, §2.8.
 *
 * No repository: every rule constant is defined in code, not persisted, so
 * this is a thin instrumented wrapper around `buildRuleViews`. `userId` stays
 * on the input purely so `execute()`'s log lines carry it for correlation —
 * the projection itself is identical for every caller. `ctx.now` (not
 * `Date.now()`) is what "last verified N days ago" is computed against, so
 * every step of one request agrees on the same instant.
 */
export class ListRulesUseCase extends QueryUseCase<ListRulesInput, readonly RuleView[]> {
  public readonly name = 'list_rules';

  protected async handle(
    _input: ListRulesInput,
    ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<readonly RuleView[]> {
    return buildRuleViews(ctx.now);
  }
}
