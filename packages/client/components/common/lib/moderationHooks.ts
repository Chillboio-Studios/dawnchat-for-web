import { Accessor, createMemo } from "solid-js";

import type { Session } from "@revolt/state/stores/Auth";
import { createQuery } from "@tanstack/solid-query";

import {
  fetchModerationActions,
  fetchModerationBootstrap,
  fetchModerationCases,
  fetchModerators,
  searchModerationImages,
  searchModerationServers,
  searchModerationUsers,
} from "./moderationApi";

export function createModerationBootstrapHook(
  session: Accessor<Session | undefined>,
) {
  return createQuery(() => ({
    queryKey: ["moderation", "bootstrap", session()?.userId],
    enabled: Boolean(session()),
    queryFn: () => fetchModerationBootstrap(session()!),
    staleTime: 30_000,
  }));
}

export function createModeratorsHook(session: Accessor<Session | undefined>) {
  return createQuery(() => ({
    queryKey: ["moderation", "moderators", session()?.userId],
    enabled: Boolean(session()),
    queryFn: () => fetchModerators(session()!),
    staleTime: 15_000,
  }));
}

export function createModerationCasesHook(
  session: Accessor<Session | undefined>,
  filters: Accessor<{
    targetType?: "user" | "message" | "server" | "image";
    targetId?: string;
    status?: "open" | "investigating" | "resolved" | "dismissed";
    query?: string;
  }>,
) {
  return createQuery(() => ({
    queryKey: ["moderation", "cases", session()?.userId, filters()],
    enabled: Boolean(session()),
    queryFn: () => fetchModerationCases(session()!, filters()),
  }));
}

export function createModerationActionsHook(
  session: Accessor<Session | undefined>,
  filters: Accessor<{
    targetType?: "user" | "message" | "server" | "image";
    targetId?: string;
    query?: string;
    limit?: number;
  }>,
) {
  return createQuery(() => ({
    queryKey: ["moderation", "actions", session()?.userId, filters()],
    enabled: Boolean(session()),
    queryFn: () => fetchModerationActions(session()!, filters()),
  }));
}

export function createModerationUserSearchHook(
  session: Accessor<Session | undefined>,
  queryText: Accessor<string>,
) {
  const normalizedQuery = createMemo(() => queryText().trim());

  return createQuery(() => ({
    queryKey: ["moderation", "search", "users", normalizedQuery()],
    enabled: Boolean(session()) && normalizedQuery().length > 0,
    queryFn: () => searchModerationUsers(session()!, normalizedQuery()),
  }));
}

export function createModerationServerSearchHook(
  session: Accessor<Session | undefined>,
  queryText: Accessor<string>,
) {
  const normalizedQuery = createMemo(() => queryText().trim());

  return createQuery(() => ({
    queryKey: ["moderation", "search", "servers", normalizedQuery()],
    enabled: Boolean(session()) && normalizedQuery().length > 0,
    queryFn: () => searchModerationServers(session()!, normalizedQuery()),
  }));
}

export function createModerationImageSearchHook(
  session: Accessor<Session | undefined>,
  queryText: Accessor<string>,
) {
  const normalizedQuery = createMemo(() => queryText().trim());

  return createQuery(() => ({
    queryKey: ["moderation", "search", "images", normalizedQuery()],
    enabled: Boolean(session()) && normalizedQuery().length > 0,
    queryFn: () => searchModerationImages(session()!, normalizedQuery()),
  }));
}

// Legacy aliases preserved for older moderation integrations.
export const createLegacyModerationBootstrapHook =
  createModerationBootstrapHook;
export const createLegacyModeratorsHook = createModeratorsHook;
export const createLegacyModerationCasesHook = createModerationCasesHook;
export const createLegacyModerationActionsHook = createModerationActionsHook;
