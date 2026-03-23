import * as Sentry from "@sentry/browser";

import { version } from "../../../package.json";

type ErrorCaptureResult = {
  eventId?: string;
  summary: string;
};

const HARD_CODED_SENTRY_DSN =
  "https://82ee7c93f5675dc1c4bbb122807eea64@o4508026382712832.ingest.us.sentry.io/4511091575095296";
const sentryDsn = HARD_CODED_SENTRY_DSN;
const sentryEnabled = Boolean(sentryDsn);

const getRuntime = () => {
  try {
    return window.native ? "desktop" : "web";
  } catch {
    return "web";
  }
};

function toErrorSummary(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    const message = error.message?.trim() || "Unknown error";
    const stackFirstLine = error.stack?.split("\n")[0]?.trim();
    return stackFirstLine && stackFirstLine !== message
      ? `${message} (${stackFirstLine})`
      : message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    tunnel: import.meta.env.VITE_SENTRY_TUNNEL,
    release: `dawnchat-client@${version}`,
    environment: import.meta.env.MODE,
    tracesSampleRate: Number(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ??
        (import.meta.env.PROD ? 0.1 : 0),
    ),
    normalizeDepth: 6,
  });

  Sentry.setTag("runtime", getRuntime());
  Sentry.setTag("ui", "client");
}

export function isSentryEnabled() {
  return sentryEnabled;
}

export function captureClientError(
  error: unknown,
  context: string,
  extras?: Record<string, unknown>,
): ErrorCaptureResult {
  const summary = toErrorSummary(error);

  if (sentryEnabled) {
    const eventId = Sentry.captureException(error, {
      tags: {
        context,
      },
      extra: extras,
    });

    return {
      eventId,
      summary,
    };
  }

  return {
    summary,
  };
}
