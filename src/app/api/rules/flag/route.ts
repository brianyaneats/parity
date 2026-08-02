import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { flagRuleSchema } from '@/lib/validation/rules';
import { FlagRuleUseCase } from '@/application/usecases/FlagRuleUseCase';
import { DrizzleRuleFlagRepository } from '@/infrastructure/persistence/repositories/DrizzleRuleFlagRepository';

const ruleFlagRepository = new DrizzleRuleFlagRepository();

/**
 * `POST /api/rules/flag` — §5.2, §2.8's "flag as changed" button. Body
 * `{ ruleKey, note? }`; rejects a `ruleKey` that does not name a rule the
 * registry actually knows about.
 */
export const POST = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = flagRuleSchema.parse(await readJson(request));

    const useCase = new FlagRuleUseCase(dependencies(logger), ruleFlagRepository);
    return useCase.execute(
      { userId: session.userId, ...payload },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'POST /api/rules/flag' },
);
