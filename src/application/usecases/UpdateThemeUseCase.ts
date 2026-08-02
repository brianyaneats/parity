import type { Logger } from '@/infrastructure/observability/Logger';
import type { ThemePatchInput } from '@/lib/validation/settings';
import type {
  UserSettingsRecord,
  UserSettingsRepository,
} from '@/application/ports/UserSettingsRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface UpdateThemeInput extends ThemePatchInput {
  readonly userId: string;
}

/**
 * `PATCH /api/settings/theme` — §5.2, §6.2.
 *
 * `ThemeProvider.setPreference` already applies the theme locally and writes
 * the cookie before this call goes out, fire-and-forget — this only has to
 * persist the choice to `user_settings.theme` so it survives to the next
 * server render. Returns the full settings record rather than just the
 * theme; the caller is free to ignore the rest.
 */
export class UpdateThemeUseCase extends CommandUseCase<UpdateThemeInput, UserSettingsRecord> {
  public readonly name = 'update_theme';

  constructor(
    deps: UseCaseDependencies,
    private readonly userSettingsRepository: UserSettingsRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: UpdateThemeInput,
    _ctx: ExecutionContext,
    _logger: Logger,
  ): Promise<UserSettingsRecord> {
    return this.userSettingsRepository.update(input.userId, { theme: input.theme });
  }

  protected override describeInput(input: UpdateThemeInput) {
    return { theme: input.theme };
  }
}
