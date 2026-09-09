import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  bootstrapAuthFromUrl,
  getAuthToken,
  onAuthInvalidated,
  setAuthToken,
} from '../../lib/auth.js';

export function AuthGate({ children }: { readonly children: React.ReactNode }) {
  const { t } = useTranslation();
  const [authed, setAuthed] = useState(() => bootstrapAuthFromUrl() || getAuthToken() !== null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthInvalidated(() => setAuthed(false)), []);

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <form
          className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            const value = input.trim();
            if (!value) {
              setError(t('auth.tokenRequired'));
              return;
            }
            setAuthToken(value);
            setError(null);
            setAuthed(true);
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
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            {t('auth.connect')}
          </button>
        </form>
      </div>
    );
  }

  return children;
}
