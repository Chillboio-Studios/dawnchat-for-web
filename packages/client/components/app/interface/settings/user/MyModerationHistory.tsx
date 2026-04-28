import { createResource, For, Show } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";

import { useClient } from "@revolt/client";
import { Column, Row, Text } from "@revolt/ui";

type ModerationLog = {
  id?: string;
  action: string;
  target_id: string;
  source_id: string;
  reason?: string | null;
  created_at: string;
  expires_at?: string | null;
  auto_expire?: boolean;
};

const ADMIN_API =
  import.meta.env.VITE_ADMIN_API_URL || "https://admin.dawn-chat.com/api";

export function MyModerationHistory() {
  const client = useClient();

  const [history] = createResource(async () => {
    const [header, token] = client().authenticationHeader;
    if (header !== "X-Session-Token") {
      throw new Error("Moderation history requires a user session.");
    }

    const response = await fetch(`${ADMIN_API}/users/@me/mod-history`, {
      headers: {
        [header]: token,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `API error: ${response.status}`);
    }

    const payload = text ? JSON.parse(text) : { history: [] };
    return (payload.history || []) as ModerationLog[];
  });

  return (
    <Column gap="lg">
      <Column gap="xs">
        <Text class="title" size="large">
          <Trans>My Moderation History</Trans>
        </Text>
        <Text>
          <Trans>Moderation actions recorded against your account.</Trans>
        </Text>
      </Column>

      <Show when={history.loading}>
        <Text>
          <Trans>Loading moderation history...</Trans>
        </Text>
      </Show>

      <Show when={history.error}>
        <Text style={{ color: "var(--md-sys-color-error)" }}>
          {String(history.error)}
        </Text>
      </Show>

      <Show when={history() && history()!.length === 0}>
        <Text>
          <Trans>No moderation actions have been recorded for your account.</Trans>
        </Text>
      </Show>

      <Show when={history() && history()!.length > 0}>
        <Column gap="md">
          <For each={history()!}>
            {(log) => (
              <Column
                gap="xs"
                style={{
                  padding: "var(--gap-md)",
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  "border-radius": "var(--borderRadius-md)",
                }}
              >
                <Row gap="sm">
                  <Text weight="bold">{log.action}</Text>
                  <Text>{new Date(log.created_at).toLocaleString()}</Text>
                </Row>
                <Text>Source: {log.source_id}</Text>
                <Text>Target: {log.target_id}</Text>
                <Show when={log.reason}>
                  <Text>Reason: {log.reason}</Text>
                </Show>
                <Show when={log.expires_at}>
                  <Text>Expires: {new Date(log.expires_at!).toLocaleString()}</Text>
                </Show>
                <Show when={log.auto_expire}>
                  <Text>Auto-expire: yes</Text>
                </Show>
              </Column>
            )}
          </For>
        </Column>
      </Show>
    </Column>
  );
}
