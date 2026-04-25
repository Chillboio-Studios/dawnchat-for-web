import env from "./env";

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

const explicitApiBase = normalizeApiBase(
  (import.meta.env.VITE_API_URL as string | undefined) ??
    (import.meta.env.VITE_CLIENT_API_URL as string | undefined),
);
const derivedApiBase = normalizeApiBase(env.DEFAULT_API_URL);
const apiBase = explicitApiBase || derivedApiBase || "https://app.dawn-chat.com/api";
const wsBase =
  (import.meta.env.VITE_WS_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  apiBase
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:")
    .replace(/\/api$/i, "/ws");

export function toClientApiUrl(pathOrUrl: string) {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(pathOrUrl)) {
    return pathOrUrl;
  }

  if (pathOrUrl.startsWith("/client-api")) {
    const suffix = pathOrUrl.slice("/client-api".length);
    return `${apiBase}${suffix}`;
  }

  if (pathOrUrl.startsWith("/api")) {
    const suffix = pathOrUrl.slice("/api".length);
    return `${apiBase}${suffix}`;
  }

  return pathOrUrl;
}

export function toClientApiWsUrl(pathname: string) {
  if (/^wss?:/i.test(pathname)) {
    return pathname;
  }

  if (pathname.startsWith("/client-api")) {
    const suffix = pathname.slice("/client-api".length);
    return `${wsBase}${suffix}`;
  }

  if (pathname.startsWith("/api")) {
    const suffix = pathname.slice("/api".length);
    return `${wsBase}${suffix}`;
  }

  // Preserve existing behavior for non-client-api relative ws paths.
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}
