const isDesktop =
  typeof window !== "undefined" &&
  ("__TAURI__" in window ||
    "__TAURI_INTERNALS__" in window ||
    window.location.hostname === "tauri.localhost" ||
    window.location.hostname.endsWith(".tauri.localhost") ||
    window.location.protocol === "tauri:");

const configuredClientApiBase = (
  import.meta.env.VITE_CLIENT_API_URL as string | undefined
)
  ?.trim()
  .replace(/\/+$/, "") ?? "https://app.dawn-chat.com/client-api";

const fallbackApiBase = (import.meta.env.VITE_API_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, "") ?? "https://app.dawn-chat.com/api";

const derivedClientApiBase = fallbackApiBase
  ? fallbackApiBase.replace(/\/api$/i, "")
  : undefined;

const clientApiBase = configuredClientApiBase || derivedClientApiBase;

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
