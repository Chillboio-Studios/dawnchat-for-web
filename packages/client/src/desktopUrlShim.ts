const browserWindow: Window | undefined =
  typeof globalThis !== "undefined" && "window" in globalThis
    ? ((globalThis as { window: Window }).window as Window)
    : undefined;

const desktopBuildTarget = (
  import.meta.env.VITE_DESKTOP_BUILD_TARGET as string | undefined
)
  ?.trim()
  .toLowerCase();

function normalizeApiBase(input: string | undefined) {
  const trimmed = input?.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;

  if (/\/api$/i.test(trimmed)) {
    return trimmed;
  }

  if (/\/client-api$/i.test(trimmed)) {
    return trimmed.replace(/\/client-api$/i, "/api");
  }

  return `${trimmed}/api`;
}

function normalizeClientApiBase(input: string | undefined) {
  const trimmed = input?.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;

  if (/\/client-api$/i.test(trimmed)) {
    return trimmed;
  }

  if (/\/api$/i.test(trimmed)) {
    return trimmed.replace(/\/api$/i, "/client-api");
  }

  return `${trimmed}/client-api`;
}

const isDesktop = (() => {
  // Desktop bundles always define this env var via scripts/build-desktop.mjs.
  if (desktopBuildTarget) return true;

  if (!browserWindow) return false;

  const tauriWindow = browserWindow as Window & Record<string, unknown>;
  const { hostname, protocol } = browserWindow.location;

  return (
    "__TAURI__" in tauriWindow ||
    "__TAURI_INTERNALS__" in tauriWindow ||
    hostname === "tauri.localhost" ||
    hostname.endsWith(".tauri.localhost") ||
    protocol === "tauri:"
  );
})();

const configuredClientApiBase = normalizeClientApiBase(
  import.meta.env.VITE_CLIENT_API_URL as string | undefined,
);

const fallbackApiBase =
  normalizeApiBase(import.meta.env.VITE_API_URL as string | undefined) ??
  "https://app.dawn-chat.com/api";

const derivedClientApiBase = normalizeClientApiBase(fallbackApiBase);

const clientApiBase =
  configuredClientApiBase ||
  derivedClientApiBase ||
  "https://app.dawn-chat.com/client-api";

if (isDesktop && clientApiBase) {
  const rewriteClientApiPath = (pathname: string) => {
    if (pathname.startsWith("/client-api")) {
      const suffix = pathname.slice("/client-api".length);
      return `${clientApiBase}${suffix}`;
    }

    if (pathname.startsWith("/api") && fallbackApiBase) {
      const suffix = pathname.slice("/api".length);
      return `${fallbackApiBase}${suffix}`;
    }

    return undefined;
  };

  const ensureAbsolute = (urlLike: string) => {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(urlLike)) {
      try {
        const parsed = new URL(urlLike);
        const rewrittenBase = rewriteClientApiPath(parsed.pathname);
        if (rewrittenBase) {
          return `${rewrittenBase}${parsed.search}${parsed.hash}`;
        }
      } catch {
        // Ignore parse failures and keep the original absolute URL.
      }

      return urlLike;
    }

    if (urlLike.startsWith("//")) {
      const protocol =
        window.location.protocol === "https:" ? "https:" : "http:";
      return `${protocol}${urlLike}`;
    }

    const rewrittenPath = rewriteClientApiPath(urlLike);
    if (rewrittenPath) return rewrittenPath;

    return urlLike;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return originalFetch(ensureAbsolute(input), init);
    }

    if (input instanceof URL) {
      return originalFetch(new URL(ensureAbsolute(input.toString())), init);
    }

    const rewritten = ensureAbsolute(input.url);
    if (rewritten === input.url) {
      return originalFetch(input, init);
    }

    return originalFetch(new Request(rewritten, input), init);
  };

  const OriginalWebSocket = window.WebSocket;
  const rewriteWs = (value: string | URL) => {
    const asString = typeof value === "string" ? value : value.toString();

    const wsBase = clientApiBase
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");

    if (asString.startsWith("/client-api")) {
      const suffix = asString.slice("/client-api".length);
      return `${wsBase}${suffix}`;
    }

    try {
      const parsed = new URL(asString, window.location.href);
      if (parsed.pathname.startsWith("/client-api")) {
        const suffix = parsed.pathname.slice("/client-api".length);
        return `${wsBase}${suffix}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // If URL parsing fails, fall back to the original URL.
    }

    return asString;
  };

  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args) {
      const [url, protocols] = args as [
        string | URL,
        string | string[] | undefined,
      ];
      const rewrittenUrl = rewriteWs(url);
      return protocols
        ? new target(rewrittenUrl, protocols)
        : new target(rewrittenUrl);
    },
  }) as typeof WebSocket;
}
