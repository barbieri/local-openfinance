import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AuthState, bootstrapAuth, login, onAuthInvalidated } from '../../lib/auth.js';

export function AuthGate({ children }: { readonly children: React.ReactNode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState>({ kind: 'checking' });
  const [input, setInput] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthInvalidated((state) => {
      queryClient.clear();
      setAuth(state);
    });
    void bootstrapAuth().then((state) => {
      if (active) {
        setAuth(state);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

  if (auth.kind === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">…</p>
      </div>
    );
  }

  if (auth.kind !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <form
          className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            const value = input.trim();
            if (!value) {
              setAuth({ kind: 'anonymous', error: t('auth.tokenRequired') });
              return;
            }
            setAuth({ kind: 'submitting' });
            const next = await login(value);
            setInput('');
            setAuth(next);
          }}
        >
          <h1 className="text-lg font-semibold">{t('app.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('auth.prompt')}</p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('auth.tokenPlaceholder')}</span>
            <input
              id="auth-token"
              type="password"
              autoComplete="off"
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              placeholder={t('auth.tokenPlaceholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={auth.kind === 'submitting'}
            />
          </label>
          {auth.kind === 'anonymous' && auth.error ? (
            <p className="text-sm text-red-600">{auth.error}</p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            disabled={auth.kind === 'submitting'}
          >
            {t('auth.connect')}
          </button>
        </form>
      </div>
    );
  }

  return children;
}
