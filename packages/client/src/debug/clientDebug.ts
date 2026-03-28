type DebugLevel = "info" | "warn" | "error";
export type DebugCategory = "api" | "voice" | "error" | "console" | "system";

export type ClientDebugEvent = {
  id: number;
  at: number;
  category: DebugCategory;
  level: DebugLevel;
  title: string;
  details?: string;
  data?: Record<string, unknown>;
};

type ClientDebugListener = (events: ClientDebugEvent[]) => void;

type MutableWindow = Window & {
  __clientDebugInstalled?: boolean;
};

type NavigatorConnectionInfo = {
  connection?: {
    effectiveType?: string;
    rtt?: number;
    downlink?: number;
    saveData?: boolean;
  };
};

const MAX_EVENTS = 1500;
let nextEventId = 1;
const events: ClientDebugEvent[] = [];
const listeners = new Set<ClientDebugListener>();

function isBenignResizeObserverIssue(value: unknown): boolean {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : "";

  return (
    text.includes(
      "ResizeObserver loop completed with undelivered notifications",
    ) || text.includes("ResizeObserver loop limit exceeded")
  );
}

function shallowCloneData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return { ...data };
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value;

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`.trim();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toErrorData(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }

  if (typeof error === "object" && error) {
    return {
      errorValue: normalizeText(error),
    };
  }

  return {
    errorValue: String(error),
  };
}

function resolveAbsoluteUrl(inputUrl: string): URL | undefined {
  try {
    return new URL(inputUrl, window.location.href);
  } catch {
    return undefined;
  }
}

function networkContext(targetUrl: string): Record<string, unknown> {
  const resolved = resolveAbsoluteUrl(targetUrl);
  const online = navigator.onLine;
  const connection = (navigator as Navigator & NavigatorConnectionInfo)
    .connection;

  return {
    pageUrl: window.location.href,
    pageOrigin: window.location.origin,
    requestUrl: targetUrl,
    resolvedUrl: resolved?.toString(),
    resolvedOrigin: resolved?.origin,
    sameOrigin: resolved
      ? resolved.origin === window.location.origin
      : undefined,
    online,
    visibilityState: document.visibilityState,
    userAgent: navigator.userAgent,
    connectionType: connection?.effectiveType,
    connectionRtt: connection?.rtt,
    connectionDownlinkMbps: connection?.downlink,
    connectionSaveData: connection?.saveData,
  };
}

function emit() {
  const snapshot = events.slice();
  for (const listener of listeners) listener(snapshot);
}

function pushEvent(event: Omit<ClientDebugEvent, "id" | "at">) {
  events.push({
    id: nextEventId++,
    at: Date.now(),
    category: event.category,
    level: event.level,
    title: event.title,
    details: event.details,
    data: shallowCloneData(event.data),
  });

  if (events.length > MAX_EVENTS) {
    const dropCount = events.length - MAX_EVENTS;
    events.splice(0, dropCount);
  }

  emit();
}

export function getClientDebugSnapshot() {
  return events.slice();
}

export function subscribeClientDebugEvents(listener: ClientDebugListener) {
  listeners.add(listener);
  listener(getClientDebugSnapshot());

  return () => {
    listeners.delete(listener);
  };
}

export function clearClientDebugEvents() {
  events.length = 0;
  emit();
}

function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const redactedHeaders = new Set([
    "authorization",
    "cookie",
    "x-session-token",
    "x-client-session-token",
  ]);

  const result: Record<string, string> = {};
  const iterator = new Headers(headers);

  for (const [key, value] of iterator.entries()) {
    const lowerKey = key.toLowerCase();
    if (redactedHeaders.has(lowerKey)) {
      result[key] = "[redacted]";
      continue;
    }

    result[key] = value;
  }

  return result;
}

function resolveFetchInput(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof input === "string") {
    return {
      method: (init?.method || "GET").toUpperCase(),
      url: input,
      headers: toHeaderRecord(init?.headers),
    };
  }

  if (input instanceof URL) {
    return {
      method: (init?.method || "GET").toUpperCase(),
      url: input.toString(),
      headers: toHeaderRecord(init?.headers),
    };
  }

  return {
    method: (init?.method || input.method || "GET").toUpperCase(),
    url: input.url,
    headers: toHeaderRecord(init?.headers || input.headers),
  };
}

function isVoiceUrl(url: string) {
  const lower = url.toLowerCase();
  return (
    lower.includes("livekit") ||
    lower.includes("/voice") ||
    lower.includes("/rtc")
  );
}

export function enableClientDebugInstrumentation() {
  if (typeof window === "undefined") return;

  const scopedWindow = window as MutableWindow;
  if (scopedWindow.__clientDebugInstalled) return;
  scopedWindow.__clientDebugInstalled = true;

  pushEvent({
    category: "system",
    level: "info",
    title: "Client debug instrumentation enabled",
    details: "Global API, voice, and error hooks are active.",
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = performance.now();
    const request = resolveFetchInput(input, init);

    try {
      const response = await originalFetch(input, init);
      const durationMs =
        Math.round((performance.now() - startedAt) * 100) / 100;

      pushEvent({
        category: "api",
        level: response.ok ? "info" : "error",
        title: `${request.method} ${request.url}`,
        details: `HTTP ${response.status} ${response.statusText} (${durationMs} ms)`,
        data: {
          method: request.method,
          url: request.url,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          durationMs,
          requestHeaders: request.headers,
          redirected: response.redirected,
          responseType: response.type,
          ...networkContext(request.url),
        },
      });

      return response;
    } catch (error) {
      const durationMs =
        Math.round((performance.now() - startedAt) * 100) / 100;
      pushEvent({
        category: "api",
        level: "error",
        title: `${request.method} ${request.url}`,
        details: `Request threw after ${durationMs} ms: ${normalizeText(error)}`,
        data: {
          method: request.method,
          url: request.url,
          durationMs,
          requestHeaders: request.headers,
          ...toErrorData(error),
          ...networkContext(request.url),
        },
      });
      throw error;
    }
  };

  window.addEventListener("error", (event) => {
    if (isBenignResizeObserverIssue(event.error || event.message)) {
      return;
    }

    pushEvent({
      category: "error",
      level: "error",
      title: "window.error",
      details: normalizeText(event.error || event.message),
      data: {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isBenignResizeObserverIssue(event.reason)) {
      return;
    }

    pushEvent({
      category: "error",
      level: "error",
      title: "window.unhandledrejection",
      details: normalizeText(event.reason),
    });
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    pushEvent({
      category: "console",
      level: "error",
      title: "console.error",
      details: args.map((entry) => normalizeText(entry)).join(" | "),
    });

    originalConsoleError(...args);
  };

  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );

    navigator.mediaDevices.getUserMedia = async (
      constraints?: MediaStreamConstraints,
    ) => {
      try {
        const stream = await originalGetUserMedia(constraints);
        pushEvent({
          category: "voice",
          level: "info",
          title: "getUserMedia success",
          details: `tracks=${stream.getTracks().length}`,
          data: {
            constraints: constraints as unknown as Record<string, unknown>,
            trackKinds: stream.getTracks().map((track) => track.kind),
          },
        });
        return stream;
      } catch (error) {
        pushEvent({
          category: "voice",
          level: "error",
          title: "getUserMedia failure",
          details: normalizeText(error),
          data: {
            constraints: constraints as unknown as Record<string, unknown>,
          },
        });
        throw error;
      }
    };
  }

  if (navigator.mediaDevices?.getDisplayMedia) {
    const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(
      navigator.mediaDevices,
    );

    navigator.mediaDevices.getDisplayMedia = async (
      options?: DisplayMediaStreamOptions,
    ) => {
      try {
        const stream = await originalGetDisplayMedia(options);
        pushEvent({
          category: "voice",
          level: "info",
          title: "getDisplayMedia success",
          details: `tracks=${stream.getTracks().length}`,
          data: {
            trackKinds: stream.getTracks().map((track) => track.kind),
          },
        });
        return stream;
      } catch (error) {
        pushEvent({
          category: "voice",
          level: "error",
          title: "getDisplayMedia failure",
          details: normalizeText(error),
        });
        throw error;
      }
    };
  }

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args) {
      const [url, protocols] = args as [
        string | URL,
        string | string[] | undefined,
      ];

      const asUrl = typeof url === "string" ? url : url.toString();
      const socket = protocols
        ? new target(asUrl, protocols)
        : new target(asUrl);

      const startedAt = performance.now();

      const category: DebugCategory = isVoiceUrl(asUrl) ? "voice" : "api";

      pushEvent({
        category,
        level: "info",
        title: "WebSocket open attempt",
        details: asUrl,
        data: {
          protocols,
          ...networkContext(asUrl),
        },
      });

      socket.addEventListener("open", () => {
        pushEvent({
          category,
          level: "info",
          title: "WebSocket open",
          details: asUrl,
          data: {
            protocol: socket.protocol,
            extensions: socket.extensions,
            readyState: socket.readyState,
            openAfterMs:
              Math.round((performance.now() - startedAt) * 100) / 100,
            ...networkContext(asUrl),
          },
        });
      });

      socket.addEventListener("error", (event) => {
        pushEvent({
          category,
          level: "error",
          title: "WebSocket error",
          details: asUrl,
          data: {
            type: event.type,
            readyState: socket.readyState,
            bufferedAmount: socket.bufferedAmount,
            protocol: socket.protocol,
            extensions: socket.extensions,
            sinceOpenAttemptMs:
              Math.round((performance.now() - startedAt) * 100) / 100,
            ...networkContext(asUrl),
          },
        });
      });

      socket.addEventListener("close", (event) => {
        pushEvent({
          category,
          level: event.wasClean ? "info" : "error",
          title: "WebSocket close",
          details: `${asUrl} (code=${event.code}, clean=${event.wasClean})`,
          data: {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            readyState: socket.readyState,
            bufferedAmount: socket.bufferedAmount,
            protocol: socket.protocol,
            extensions: socket.extensions,
            sinceOpenAttemptMs:
              Math.round((performance.now() - startedAt) * 100) / 100,
            ...networkContext(asUrl),
          },
        });
      });

      return socket;
    },
  }) as typeof WebSocket;

  if (typeof window.RTCPeerConnection !== "undefined") {
    const OriginalRTCPeerConnection = window.RTCPeerConnection;

    window.RTCPeerConnection = new Proxy(OriginalRTCPeerConnection, {
      construct(target, args) {
        const peer = new target(
          ...(args as ConstructorParameters<typeof RTCPeerConnection>),
        );

        pushEvent({
          category: "voice",
          level: "info",
          title: "RTCPeerConnection created",
        });

        peer.addEventListener("connectionstatechange", () => {
          pushEvent({
            category: "voice",
            level:
              peer.connectionState === "failed" ||
              peer.connectionState === "disconnected"
                ? "error"
                : "info",
            title: "RTCPeerConnection state",
            details: peer.connectionState,
          });
        });

        peer.addEventListener("iceconnectionstatechange", () => {
          pushEvent({
            category: "voice",
            level:
              peer.iceConnectionState === "failed" ||
              peer.iceConnectionState === "disconnected"
                ? "error"
                : "info",
            title: "ICE connection state",
            details: peer.iceConnectionState,
          });
        });

        peer.addEventListener("icecandidateerror", (event: Event) => {
          const iceError = event as Event & {
            errorCode?: number;
            errorText?: string;
            address?: string;
            port?: number;
            url?: string;
          };
          pushEvent({
            category: "voice",
            level: "error",
            title: "ICE candidate error",
            details: `${iceError.errorCode ?? "unknown"} ${
              iceError.errorText ?? ""
            }`.trim(),
            data: {
              address: iceError.address,
              port: iceError.port,
              url: iceError.url,
            },
          });
        });

        return peer;
      },
    }) as typeof RTCPeerConnection;
  }
}
