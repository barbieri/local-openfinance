import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import 'sonner/dist/styles.css';
import { App } from './App.js';
import { initI18n } from './lib/i18n.js';
import { AppNavigationProvider } from './lib/navigation.js';
import './theme/banking.css';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

void initI18n().then(() => {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('root element missing');
  }
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppNavigationProvider>
          <App />
          <Toaster position="bottom-right" duration={10_000} closeButton richColors />
        </AppNavigationProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
