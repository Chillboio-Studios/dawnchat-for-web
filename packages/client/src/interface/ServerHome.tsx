import { Component, Match, Switch, createMemo } from "solid-js";

import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import { Navigate, useParams } from "@revolt/routing";

/**
 * Server home component
 */
export const ServerHome: Component = () => {
  const params = useParams();
  const client = useClient();
  const server = createMemo(() => client()!.servers.get(params.server)!);
  const isServerDisabled = createMemo(() => {
    const value = server() as
      | {
          moderation_disabled?: boolean;
          moderationDisabled?: boolean;
          moderation?: { disabled?: boolean };
        }
      | undefined;

    return Boolean(
      value?.moderation_disabled ||
        value?.moderationDisabled ||
        value?.moderation?.disabled,
    );
  });

  return (
    // TODO: port the nice fallback
    <Switch fallback="No channels!">
      <Match when={!server()}>
        <Navigate href={"/"} />
      </Match>
      <Match when={isServerDisabled()}>
        <BlockedPage>
          <h2>This server is currently disabled.</h2>
          <p>
            Moderation has disabled access to this server. Please contact the
            platform moderation team if you think this is a mistake.
          </p>
        </BlockedPage>
      </Match>
      <Match when={server().defaultChannel}>
        <Navigate href={`channel/${server().defaultChannel!.id}`} />
      </Match>
    </Switch>
  );
};

const BlockedPage = styled("div", {
  base: {
    padding: "24px",
    margin: "24px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    display: "grid",
    gap: "8px",
  },
});
