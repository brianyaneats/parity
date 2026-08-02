'use client';

import { useState } from 'react';
import { Button, Card, Input } from '@/components/ui';

/**
 * Data export and account deletion — §12, non-negotiable.
 *
 * > "**Data export and deletion** must both work from `/settings` and must
 * > actually cascade. Test it."
 *
 * The deletion control is deliberately awkward. §1.5's fourth success criterion
 * is that the savings ledger survives the user's own audit — which only holds
 * if a year of records cannot be destroyed by a mis-click. So deletion requires
 * typing the account's email address, and the confirmation field only appears
 * after an explicit first step.
 *
 * It is an inline expansion, not a modal: §0.5 bans "any modal that could have
 * been an inline expansion", and this one could.
 */
export function AccountDataSection({
  email,
  signedIn,
}: {
  email: string;
  signedIn: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typedEmail, setTypedEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch('/api/account/export');
      if (!response.ok) {
        setError('Could not build the export. Nothing was changed.');
        return;
      }
      const data = (await response.json()) as { comparisons?: unknown[] };

      // Downloaded client-side from the JSON response rather than served as an
      // attachment, so the file never touches disk on the server and no
      // temporary copy of the user's hotel list outlives the request (§12).
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `parity-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setExported(
        `Downloaded ${Array.isArray(data.comparisons) ? data.comparisons.length : 0} comparisons and everything linked to them.`,
      );
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmEmail: typedEmail }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? 'Could not delete the account.');
        return;
      }
      window.location.assign('/login');
    } catch {
      setError('Could not reach the server. Nothing was deleted.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-h2 text-text-primary">Your data</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Parity holds the rates you entered, the comparisons it computed from them, and any
          claim evidence you uploaded. It never held a password or a card number.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-text-primary">Export everything</h3>
        <p className="text-sm text-text-secondary">
          One JSON file with every comparison, quote, competing rate, booking, claim, credit
          bucket and ledger entry, plus the storage keys for any screenshots you uploaded.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={exportData}
            loading={exporting}
            disabled={!signedIn}
          >
            Download my data
          </Button>
          {exported ? (
            <span role="status" className="text-xs text-text-muted">
              {exported}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-h3 text-text-primary">Delete this account</h3>
        <p className="text-sm text-text-secondary">
          Removes your settings, cards, trips, comparisons, quotes, competing rates, bookings,
          claims, watchlist, ledger and property overrides. This cannot be undone — export
          first if you want a copy.
        </p>

        {!confirming ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={!signedIn}
            onClick={() => setConfirming(true)}
            className="self-start"
          >
            Delete account
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-status-critical p-3">
            <Input
              label={`Type ${email} to confirm`}
              value={typedEmail}
              onChange={(event) => setTypedEmail(event.target.value)}
              autoComplete="off"
              placeholder={email}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                loading={deleting}
                disabled={typedEmail.trim().toLowerCase() !== email.toLowerCase()}
                onClick={deleteAccount}
              >
                Permanently delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  setTypedEmail('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-text-primary">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
