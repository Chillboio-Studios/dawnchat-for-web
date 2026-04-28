import { createResource, For, Show } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";

import { useClient } from "@revolt/client";
import { Column, Row, Text } from "@revolt/ui";

type AccountStandingUser = {
  id: string;
  username: string;
  discriminator: string;
  display_name?: string | null;
  flags?: number | null;
  privileged?: boolean;
  suspended_until?: string | null;
  suspension_reason?: string | null;
  ban_reason?: string | null;
};

const flagLabels = [
  { bit: 1, label: "Suspended" },
  { bit: 2, label: "Deleted" },
  { bit: 4, label: "Banned" },
];

export function MyAccountStanding() {
  const client = useClient();

  const [profile] = createResource(async () =>
    client().api.get("/users/@me") as Promise<AccountStandingUser>,
  );

  const standing = () => profile();

  return (
    <Column gap="lg">
      <Column gap="xs">
        <Text class="title" size="large">
          <Trans>My Account Standing</Trans>
        </Text>
        <Text>
          <Trans>
            A short summary of your current moderation status on the platform.
          </Trans>
        </Text>
      </Column>

      <Show when={profile.loading}>
        <Text>
          <Trans>Loading standing information...</Trans>
        </Text>
      </Show>

      <Show when={profile.error}>
        <div style={{ color: "var(--md-sys-color-error)" }}>{String(profile.error)}</div>
      </Show>

      <Show when={standing()}>
        <Column gap="md">
          <Row gap="sm">
            <span style={{ fontWeight: 700 }}>User</span>
            <Text>
              {standing()!.username}#{standing()!.discriminator}
            </Text>
          </Row>

          <Row gap="sm">
            <span style={{ fontWeight: 700 }}>Display name</span>
            <Text>{standing()!.display_name || "none"}</Text>
          </Row>

          <Row gap="sm">
            <span style={{ fontWeight: 700 }}>Privileged</span>
            <Text>{standing()!.privileged ? "yes" : "no"}</Text>
          </Row>

          <Row gap="sm">
            <span style={{ fontWeight: 700 }}>Flags</span>
            <Text>{standing()!.flags ?? 0}</Text>
          </Row>

          <Column gap="sm">
            <span style={{ fontWeight: 700 }}>Flag breakdown</span>
            <For each={flagLabels}>
              {(flag) => (
                <div>
                  {flag.label}: {Boolean((standing()!.flags ?? 0) & flag.bit) ? "yes" : "no"}
                </div>
              )}
            </For>
          </Column>

          <Show when={standing()!.ban_reason || standing()!.suspension_reason || standing()!.suspended_until}>
            <Column gap="sm">
              <span style={{ fontWeight: 700 }}>Moderation status</span>
              <Show when={standing()!.ban_reason}>
                <Text>Ban reason: {standing()!.ban_reason}</Text>
              </Show>
              <Show when={standing()!.suspension_reason}>
                <Text>Suspension reason: {standing()!.suspension_reason}</Text>
              </Show>
              <Show when={standing()!.suspended_until}>
                <Text>
                  Suspended until: {new Date(standing()!.suspended_until!).toLocaleString()}
                </Text>
              </Show>
            </Column>
          </Show>

          <Show when={!standing()!.ban_reason && !standing()!.suspension_reason && !(standing()!.flags ?? 0)}>
            <Text>Your account is currently in good standing.</Text>
          </Show>
        </Column>
      </Show>
    </Column>
  );
}
