import { createEffect, onCleanup } from "solid-js";

import { useClient } from "@revolt/client";
import { toClientApiUrl } from "@revolt/common/lib/clientApiUrl";
import { useState } from "@revolt/state";

const SAVE_DEBOUNCE_MS = 1200;

/**
 * Sync notification options to/from backend persistence.
 */
export function NotificationSettingsWorker() {
  const client = useClient();
  const state = useState();

  let loadedUserId: string | undefined;
  let suppressSave = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(userId: string) {
    try {
      const query = new URLSearchParams({ userId });
      const response = await fetch(
        toClientApiUrl(`/client-api/notification-settings?${query.toString()}`),
      );

      if (!response.ok) return;

      const payload = (await response.json()) as {
        item?: { settings?: unknown } | null;
      };

      if (!payload.item?.settings) return;

      suppressSave = true;
      const cleaned = state.notifications.clean(payload.item.settings as never);
      state.set("notifications", cleaned);
      suppressSave = false;
    } catch {
      suppressSave = false;
    }
  }

  async function save(userId: string) {
    try {
      await fetch(toClientApiUrl("/client-api/notification-settings"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          settings: state.get("notifications"),
        }),
      });
    } catch {
      // Ignore transient network issues.
    }
  }

  createEffect(() => {
    const userId = client().user?.id;
    if (!userId) return;

    if (loadedUserId !== userId) {
      loadedUserId = userId;
      void load(userId);
    }

    const fingerprint = JSON.stringify(state.get("notifications"));
    void fingerprint;

    if (suppressSave) return;

    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void save(userId);
    }, SAVE_DEBOUNCE_MS);
  });

  onCleanup(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
  });

  return null;
}
