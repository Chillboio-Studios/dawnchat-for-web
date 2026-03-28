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

const explicitClientApiBase = normalizeClientApiBase(
  import.meta.env.VITE_CLIENT_API_URL as string | undefined,
);
const derivedApiBase = normalizeApiBase(env.DEFAULT_API_URL);
const derivedClientApiBase = normalizeClientApiBase(derivedApiBase);

const clientApiBase = derivedClientApiBase
  ? explicitClientApiBase || derivedClientApiBase
  : explicitClientApiBase || "https://app.dawn-chat.com/client-api";

export function toClientApiUrl(pathOrUrl: string) {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(pathOrUrl)) {
    return pathOrUrl;
  }

  if (!pathOrUrl.startsWith("/client-api")) {
    return pathOrUrl;
  }

  const suffix = pathOrUrl.slice("/client-api".length);
  return `${clientApiBase}${suffix}`;
}

export function toClientApiWsUrl(pathname: string) {
  if (/^wss?:/i.test(pathname)) {
    return pathname;
  }

  if (pathname.startsWith("/client-api")) {
    const wsBase = clientApiBase
      .replace(/^http:/i, "ws:")
      .replace(/^https:/i, "wss:");
    const suffix = pathname.slice("/client-api".length);
    return `${wsBase}${suffix}`;
  }

  // Preserve existing behavior for non-client-api relative ws paths.
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}
