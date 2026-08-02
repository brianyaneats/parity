import type { Logger } from '@/infrastructure/observability/Logger';
import { ApiError } from '@/lib/api/errors';
import { findRule } from '@/domain/rules/registry';
import type { FlagRuleInput } from '@/lib/validation/rules';
import type {
  NewRuleFlagInput,
  RuleFlagRecord,
  RuleFlagRepository,
} from '@/application/ports/RuleFlagRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface FlagRuleUseCaseInput extends FlagRuleInput {
  readonly userId: string;
}

/**
 * `POST /api/rules/flag` — §5.2, §2.8's "flag as changed" button.
 *
 * Validates `ruleKey` against the live registry before writing anything:
 * §2.8's flag only means something against a rule that actually exists on
 * `/settings/rules`, and a typo'd key would otherwise create an orphan flag
 * no screen ever surfaces, silently swallowing the user's report.
 */
export class FlagRuleUseCase extends CommandUseCase<FlagRuleUseCaseInput, RuleFlagRecord> {
  public readonly name = 'flag_rule';

  constructor(
    deps: UseCaseDependencies,
    private readonly ruleFlagRepository: RuleFlagRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: FlagRuleUseCaseInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<RuleFlagRecord> {
    const rule = findRule(input.ruleKey);
    if (!rule) {
      throw ApiError.validation('Unknown rule key.', {
        ruleKey: 'does not match any known rule constant',
      });
    }

    const payload: NewRuleFlagInput = {
      userId: input.userId,
      ruleKey: input.ruleKey,
      note: input.note ?? null,
    };

    return this.ruleFlagRepository.create(payload);
  }

  protected override describeInput(input: FlagRuleUseCaseInput) {
    return { ruleKey: input.ruleKey };
  }
}
