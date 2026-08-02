import { route, readJson } from '@/lib/api/handler';
import { requireUser } from '@/lib/auth/session';
import { dependencies, executionContext } from '@/application/runtime';
import { themePatchSchema } from '@/lib/validation/settings';
import { UpdateThemeUseCase } from '@/application/usecases/UpdateThemeUseCase';
import { DrizzleUserSettingsRepository } from '@/infrastructure/persistence/repositories/DrizzleUserSettingsRepository';

const userSettingsRepository = new DrizzleUserSettingsRepository();

/**
 * `PATCH /api/settings/theme` — §5.2, §6.2. Body `{ theme }`. Called
 * fire-and-forget by `ThemeProvider.setPreference` after the client has
 * already applied the theme and written the cookie, so it should succeed
 * silently.
 */
export const PATCH = route(
  async ({ request, logger, requestId }) => {
    const session = await requireUser();
    const payload = themePatchSchema.parse(await readJson(request));

    const useCase = new UpdateThemeUseCase(dependencies(logger), userSettingsRepository);
    return useCase.execute(
      { userId: session.userId, ...payload },
      executionContext(session.userId, requestId),
    );
  },
  { name: 'PATCH /api/settings/theme' },
);
