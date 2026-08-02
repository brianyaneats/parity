import type { Logger } from '@/infrastructure/observability/Logger';
import type { PropertyRecord, PropertyRepository } from '@/application/ports/PropertyRepository';
import type { CreatePropertyInput as CreatePropertyPayload } from '@/lib/validation/properties';
import { cents } from '@/domain/shared/cents';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface CreatePropertyInput extends CreatePropertyPayload {
  readonly userId: string;
}

/**
 * `POST /api/properties` — §7.8.
 *
 * Route-created properties are always user-scoped: this use case never writes
 * a `userId = NULL` row, so a user's own entry always shadows rather than
 * mutates a seed of the same name.
 */
export class CreatePropertyUseCase extends CommandUseCase<CreatePropertyInput, PropertyRecord> {
  public readonly name = 'create_property';

  constructor(
    deps: UseCaseDependencies,
    private readonly propertyRepository: PropertyRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: CreatePropertyInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<PropertyRecord> {
    return this.propertyRepository.create({
      userId: input.userId,
      name: input.name,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      brand: input.brand,
      inFhr: input.inFhr,
      inThc: input.inThc,
      inEdit: input.inEdit,
      propertyCreditFaceCents:
        input.propertyCreditFaceCents !== undefined ? cents(input.propertyCreditFaceCents) : undefined,
      propertyCreditKind: input.propertyCreditKind ?? null,
      notes: input.notes ?? null,
    });
  }

  protected override describeInput(input: CreatePropertyInput) {
    return { city: input.city ?? null, brand: input.brand ?? null };
  }
}
