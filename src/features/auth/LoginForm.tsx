'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';

/**
 * Magic-link request form.
 *
 * Deliberately reports the same message whether or not the address is
 * registered. Telling an anonymous visitor "no account with that email" turns
 * the login form into an account-enumeration oracle, and §12 treats the fact
 * that someone uses this product as sensitive in itself.
 */
export function LoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('sending');
    try {
      const response = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setState(response.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <p role="status" className="text-sm text-text-secondary">
        If an account exists for {email}, a sign-in link is on its way. The link works once and
        expires in 15 minutes.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        autoComplete="email"
        placeholder="you@example.com"
        {...(state === 'error' ? { error: 'Could not send the link. Try again.' } : {})}
      />
      <Button type="submit" variant="primary" loading={state === 'sending'}>
        Email me a sign-in link
      </Button>
    </form>
  );
}
