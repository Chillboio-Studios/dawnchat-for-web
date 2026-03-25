const isDesktop =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

const configuredClientApiBase = (
  import.meta.env.VITE_CLIENT_API_URL as string | undefined
)
  ?.trim()
  .replace(/\/+$/, "");

const fallbackApiBase = (import.meta.env.VITE_API_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

const derivedClientApiBase = fallbackApiBase
  ? fallbackApiBase.replace(/\/api$/i, "")
  : undefined;

const clientApiBase = configuredClientApiBase || derivedClientApiBase;

if (isDesktop && clientApiBase) {
  const ensureAbsolute = (urlLike: string) => {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(urlLike)) {
      return urlLike;
    }

    if (urlLike.startsWith("//")) {
      const protocol =
        window.location.protocol === "https:" ? "https:" : "http:";
      return `${protocol}${urlLike}`;
    }

    if (urlLike.startsWith("/client-api")) {
      const suffix = urlLike.slice("/client-api".length);
      return `${clientApiBase}${suffix}`;
    }

    if (urlLike.startsWith("/api") && fallbackApiBase) {
      const suffix = urlLike.slice("/api".length);
      return `${fallbackApiBase}${suffix}`;
    }

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
    if (!asString.startsWith("/client-api")) {
      return asString;
    }

    const suffix = asString.slice("/client-api".length);
    const wsBase = clientApiBase
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");
    return `${wsBase}${suffix}`;
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
