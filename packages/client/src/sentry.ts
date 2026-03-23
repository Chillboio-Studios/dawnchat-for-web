import * as Sentry from "@sentry/browser";

import { version } from "../../../package.json";

const sentryEnabled = !!(import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    tunnel: import.meta.env.VITE_SENTRY_TUNNEL,
    release: version,
    // tracing:
    // integrations: [Sentry.browserTracingIntegration()],
    // tracesSampleRate: 0.1,
  });
}

export function captureClientError(error: unknown, context: string) {
  if (sentryEnabled) {
    Sentry.captureException(error, {
      tags: {
        context,
      },
    });
  }
}
