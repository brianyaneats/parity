import { PropertiesScreen } from '@/features/properties/PropertiesScreen';
import { PROPERTY_SEEDS } from '@/infrastructure/persistence/seed/properties.seed';
import { getSession } from '@/lib/auth/session';
import type { BrandOrNone } from '@/domain/rules/channels.rules';
import type { PropertyOption } from '@/features/compare/CompareScreen';

export const metadata = { title: 'Properties · Parity' };

/**
 * `/properties` — §7.8.
 *
 * Copies `/compare`'s own fallback pattern verbatim (see
 * `src/app/(app)/compare/page.tsx`): try `listProperties`, fall back to the
 * static `PROPERTY_SEEDS` when the database is unreachable. The same
 * reasoning applies here as there — a properties screen that goes blank the
 * moment the database blips is worse than a read-only one showing seed data.
 */
export default async function PropertiesPage() {
  const session = await getSession();
  const properties = await loadProperties(session?.userId);

  return <PropertiesScreen properties={properties} signedIn={session !== null} />;
}

async function loadProperties(userId: string | undefined): Promise<readonly PropertyOption[]> {
  try {
    const { listProperties } = await import('@/infrastructure/persistence/queries/properties');
    const rows = await listProperties(userId);
    if (rows.length > 0) return rows;
  } catch {
    // Fall through to the seeds.
  }

  return PROPERTY_SEEDS.map((seed, index) => ({
    id: `seed-${index}`,
    name: seed.name,
    city: seed.city,
    brand: seed.brand as BrandOrNone,
    inFhr: seed.inFhr,
    inThc: seed.inThc,
    inEdit: seed.inEdit,
    propertyCreditFaceCents: seed.propertyCreditFaceCents,
    propertyCreditKind: seed.propertyCreditKind,
  }));
}
