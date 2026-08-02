import { Card } from '@/components/ui';
import { LoginForm } from '@/features/auth/LoginForm';

export const metadata = { title: 'Sign in · Parity' };

/**
 * `/login` — §7.1, magic link.
 *
 * §12 is the binding constraint here and it is worth restating on the screen
 * itself: "Parity never asks for, stores, transmits, or proxies a bank,
 * card-issuer, or hotel-portal password. No OAuth-shaped workaround."
 *
 * A magic link is the whole authentication story. There is no password field on
 * this page because there is no password anywhere in this product.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-h1 text-text-primary">Parity</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Which channel wins, by how much, and what you forfeit by choosing wrong.
        </p>

        <div className="mt-5">
          <LoginForm />
        </div>

        <p className="mt-5 border-t border-border pt-4 text-xs text-text-muted">
          Parity never asks for a bank, card-issuer, or hotel password, and never connects to
          your accounts. You enter rates; it does the arithmetic.
        </p>
      </Card>
    </main>
  );
}
