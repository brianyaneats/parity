import { buildRuleViews } from '@/domain/rules/registry';
import { RulesScreen } from '@/features/settings/RulesScreen';

export const metadata = { title: 'Rules · Parity' };

/**
 * `/settings/rules` — §7.8, §2.8.
 *
 * Unlike `/properties` or `/compare`, this page needs no database and no
 * fallback branch: `buildRuleViews` is a pure function over the in-memory
 * rule registry (`src/domain/rules/*.rules.ts`), so "the database is
 * unreachable" is not a state this screen can ever be in. `now` is read once
 * here, at the composition boundary, rather than threaded through as a Clock
 * dependency — that discipline matters inside the pure domain (§3, §10.2),
 * not in a server component that renders once per request.
 */
export default function RulesPage() {
  const views = buildRuleViews(new Date());
  return <RulesScreen views={views} />;
}
