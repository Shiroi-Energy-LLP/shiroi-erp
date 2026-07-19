import * as Sentry from '@sentry/nextjs';
import { beforeSend } from './src/lib/observability/sentry-redact';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === 'production',
  sendDefaultPii: false,
  beforeSend,
});
