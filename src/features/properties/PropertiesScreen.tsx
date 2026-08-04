'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  DataTable,
  EmptyState,
  Input,
  Select,
  Toggle,
  useToast,
  type DataTableColumn,
  type SortDirection,
} from '@/components/ui';
import { formatCentsRounded } from '@/lib/format';
import type { BrandOrNone } from '@/domain/rules/channels.rules';
import { PROPERTY_CREDIT_KIND_HINTS, type PropertyCreditKind } from '@/domain/rules/perks.rules';
import type { PropertyOption } from '@/features/compare/CompareScreen';
import { savePropertyOverride } from './actions';

/**
 * `/properties` — §7.8, §8.5.
 *
 * "Seeded program membership means the comparator can pre-populate the right
 * channel rows and warn when a user is about to compare FHR at a property
 * that isn't in FHR. User corrections write user-scoped overrides. Over time
 * this becomes the app's most valuable data." This screen is where those
 * corrections happen — a searchable table plus an inline editor that never
 * mutates a seed, only ever writes the current user's own shadow row
 * (`savePropertyOverride`, §7.8's "shadow seeds rather than mutating them").
 */

const BRAND_VALUES = [
  'NONE',
  'HILTON',
  'MARRIOTT',
  'HYATT',
  'IHG',
  'WYNDHAM',
  'CHOICE',
  'BEST_WESTERN',
] as const satisfies readonly BrandOrNone[];

type AssertNever<T extends never> = T;
// Compile error if the domain gains/loses a brand this screen doesn't know about.
export type UncoveredBrand = AssertNever<Exclude<BrandOrNone, (typeof BRAND_VALUES)[number]>>;

const BRAND_LABELS: Readonly<Record<BrandOrNone, string>> = Object.freeze({
  NONE: 'No chain',
  HILTON: 'Hilton',
  MARRIOTT: 'Marriott',
  HYATT: 'Hyatt',
  IHG: 'IHG',
  WYNDHAM: 'Wyndham',
  CHOICE: 'Choice',
  BEST_WESTERN: 'Best Western',
});

const BRAND_OPTIONS = BRAND_VALUES.map((brand) => ({ value: brand, label: BRAND_LABELS[brand] }));

const CREDIT_KIND_VALUES = ['DINING', 'SPA', 'RESORT', 'ANY'] as const satisfies readonly PropertyCreditKind[];
const CREDIT_KIND_OPTIONS = CREDIT_KIND_VALUES.map((kind) => ({ value: kind, label: kind }));

interface EditDraft {
  readonly brand: BrandOrNone;
  readonly inFhr: boolean;
  readonly inThc: boolean;
  readonly inEdit: boolean;
  readonly propertyCreditFaceCents: number | null;
  readonly propertyCreditKind: PropertyCreditKind;
}

function draftFrom(property: PropertyOption): EditDraft {
  return {
    brand: property.brand,
    inFhr: property.inFhr,
    inThc: property.inThc,
    inEdit: property.inEdit,
    propertyCreditFaceCents: property.propertyCreditFaceCents,
    propertyCreditKind: (property.propertyCreditKind as PropertyCreditKind) || 'ANY',
  };
}

export interface PropertiesScreenProps {
  readonly properties: readonly PropertyOption[];
  readonly signedIn: boolean;
}

export function PropertiesScreen({ properties: initialProperties, signedIn }: PropertiesScreenProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [properties, setProperties] = React.useState<readonly PropertyOption[]>(initialProperties);
  React.useEffect(() => setProperties(initialProperties), [initialProperties]);

  const [query, setQuery] = React.useState('');
  const [sortKey, setSortKey] = React.useState('name');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('asc');

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<EditDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows =
      needle === ''
        ? properties
        : properties.filter(
            (p) => p.name.toLowerCase().includes(needle) || p.city.toLowerCase().includes(needle),
          );

    return [...rows].sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;
      if (sortKey === 'city') return a.city.localeCompare(b.city) * direction;
      return a.name.localeCompare(b.name) * direction;
    });
  }, [properties, query, sortKey, sortDirection]);

  const startEdit = (property: PropertyOption) => {
    setEditingId(property.id);
    setDraft(draftFrom(property));
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
    setSaveError(null);
  };

  const editingProperty = properties.find((p) => p.id === editingId) ?? null;

  const handleSave = async () => {
    if (!editingProperty || !draft) return;
    setSaving(true);
    setSaveError(null);

    const result = await savePropertyOverride({
      name: editingProperty.name,
      city: editingProperty.city.trim() === '' ? null : editingProperty.city,
      brand: draft.brand,
      inFhr: draft.inFhr,
      inThc: draft.inThc,
      inEdit: draft.inEdit,
      propertyCreditFaceCents: draft.propertyCreditFaceCents ?? 0,
      propertyCreditKind: draft.propertyCreditKind,
    });

    setSaving(false);

    if (result.ok) {
      // Optimistic patch so the table reflects the edit instantly; `router.refresh()`
      // then reconciles against the server's own shadow-resolved row — the same
      // optimistic-then-authoritative shape `useComparison` uses for `/compare`.
      setProperties((rows) =>
        rows.map((row) =>
          row.id === editingProperty.id
            ? {
                ...row,
                brand: draft.brand,
                inFhr: draft.inFhr,
                inThc: draft.inThc,
                inEdit: draft.inEdit,
                propertyCreditFaceCents: draft.propertyCreditFaceCents ?? 0,
                propertyCreditKind: draft.propertyCreditKind,
              }
            : row,
        ),
      );
      toast({ title: 'Saved', description: `${editingProperty.name} now uses your own edit.`, variant: 'success' });
      cancelEdit();
      router.refresh();
    } else {
      setSaveError(result.message);
      toast({ title: 'Could not save', description: result.message, variant: 'error' });
    }
  };

  const columns: readonly DataTableColumn<PropertyOption>[] = React.useMemo(
    () => [
      {
        key: 'name',
        header: 'Property',
        sortable: true,
        render: (row) => <span className="font-medium text-text-primary">{row.name}</span>,
      },
      {
        key: 'city',
        header: 'City',
        sortable: true,
        render: (row) => <span className="text-text-secondary">{row.city || '—'}</span>,
      },
      {
        key: 'programmes',
        header: 'Programmes',
        render: (row) => (
          <div className="flex flex-wrap gap-1">
            {row.inFhr ? <Badge variant="neutral">FHR</Badge> : null}
            {row.inThc ? <Badge variant="neutral">THC</Badge> : null}
            {row.inEdit ? <Badge variant="neutral">Edit</Badge> : null}
            {row.brand !== 'NONE' ? <Badge variant="neutral">{BRAND_LABELS[row.brand]}</Badge> : null}
            {!row.inFhr && !row.inThc && !row.inEdit && row.brand === 'NONE' ? (
              <span className="text-xs text-text-muted">None recorded</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'credit',
        header: 'Property credit',
        numeric: true,
        render: (row) => (
          <span className="tnum text-text-primary">
            {formatCentsRounded(row.propertyCreditFaceCents)}{' '}
            <span className="text-xs text-text-muted">· {row.propertyCreditKind}</span>
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        render: (row) => (
          <Button variant="secondary" size="sm" onClick={() => startEdit(row)}>
            Edit
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-4 lg:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 text-text-primary">Properties</h1>
        <p className="text-sm text-text-secondary">
          Programme membership and on-property credit for every seeded and saved hotel. Editing a
          property here never changes the shared seed — it creates your own correction, which the
          comparator prefers whenever it exists.
        </p>
        {!signedIn ? (
          <p className="text-xs text-status-warning">Sign in to save your own corrections.</p>
        ) : null}
      </header>

      {properties.length === 0 ? (
        <EmptyState
          message="No properties saved. Add one from the compare screen, or browse the seeded set."
          action={{ label: 'Compare a stay', onClick: () => router.push('/compare') }}
        />
      ) : (
        <>
          <Input
            label="Search properties"
            hideLabel
            placeholder="Search by name or city…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            containerClassName="max-w-sm"
          />

          {editingProperty && draft ? (
            <Card className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-h3 text-text-primary">Editing {editingProperty.name}</h2>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>

              <Select
                label="Chain brand"
                value={draft.brand}
                onChange={(value) => setDraft({ ...draft, brand: value as BrandOrNone })}
                options={BRAND_OPTIONS}
              />

              <div className="flex flex-wrap gap-4">
                <Toggle
                  label="Fine Hotels + Resorts"
                  checked={draft.inFhr}
                  onCheckedChange={(checked) => setDraft({ ...draft, inFhr: checked })}
                />
                <Toggle
                  label="The Hotel Collection"
                  checked={draft.inThc}
                  onCheckedChange={(checked) => setDraft({ ...draft, inThc: checked })}
                />
                <Toggle
                  label="The Edit"
                  checked={draft.inEdit}
                  onCheckedChange={(checked) => setDraft({ ...draft, inEdit: checked })}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <CurrencyInput
                  label="Property credit face value"
                  value={draft.propertyCreditFaceCents}
                  onChange={(cents) => setDraft({ ...draft, propertyCreditFaceCents: cents })}
                />
                <Select
                  label="Credit kind"
                  value={draft.propertyCreditKind}
                  onChange={(value) => setDraft({ ...draft, propertyCreditKind: value as PropertyCreditKind })}
                  options={CREDIT_KIND_OPTIONS}
                  hint={PROPERTY_CREDIT_KIND_HINTS[draft.propertyCreditKind]}
                />
              </div>

              {saveError ? (
                <p role="alert" className="text-sm text-status-critical">
                  {saveError}
                </p>
              ) : null}

              <div>
                <Button variant="primary" loading={saving} disabled={!signedIn} onClick={() => void handleSave()}>
                  Save as my override
                </Button>
              </div>
            </Card>
          ) : null}

          <DataTable
            columns={columns}
            rows={filtered}
            getRowId={(row) => row.id}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={(key, direction) => {
              setSortKey(key);
              setSortDirection(direction);
            }}
            emptyMessage="No properties match your search."
            caption="Properties"
          />
        </>
      )}
    </div>
  );
}
