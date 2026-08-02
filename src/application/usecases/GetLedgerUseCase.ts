import type { Logger } from '@/infrastructure/observability/Logger';
import type { LedgerQuery } from '@/lib/validation/ledger';
import type {
  SavingsEventListFilter,
  SavingsEventListResult,
  SavingsEventRepository,
} from '@/application/ports/SavingsEventRepository';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface GetLedgerInput extends LedgerQuery {
  readonly userId: string;
}

/**
 * `GET /api/ledger` — §5.2.
 *
 * A thin read over `SavingsEventRepository.list`: the query schema's `from`/
 * `to`/`realized` are already validated and typed by `ledgerQuerySchema`, so
 * this only has to drop the `undefined` fields the filter type treats as
 * "not provided" rather than passing them through as explicit `undefined`.
 */
export class GetLedgerUseCase extends QueryUseCase<GetLedgerInput, SavingsEventListResult> {
  public readonly name = 'get_ledger';

  constructor(
    deps: UseCaseDependencies,
    private readonly savingsEventRepository: SavingsEventRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: GetLedgerInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<SavingsEventListResult> {
    const filter: SavingsEventListFilter = {
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.to !== undefined ? { to: input.to } : {}),
      ...(input.realized !== undefined ? { realized: input.realized } : {}),
    };

    return this.savingsEventRepository.list(input.userId, filter);
  }

  protected override describeInput(input: GetLedgerInput) {
    return {
      hasFrom: input.from !== undefined,
      hasTo: input.to !== undefined,
      realized: input.realized ?? null,
    };
  }
}
