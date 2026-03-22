import { Show } from "solid-js";

import { Trans, useLingui } from "@lingui-solid/solid/macro";
import { User } from "stoat.js";
import { styled } from "styled-system/jsx";

import { getEffectiveUserStatus } from "@revolt/client";

import { Text, typography } from "../../design";

import { ProfileCard } from "./ProfileCard";

export function ProfileStatus(props: { user: User }) {
  const { t } = useLingui();
  const effectiveStatus = () => getEffectiveUserStatus(props.user);
  const fallbackPresenceText = () => {
    switch (effectiveStatus()?.presence) {
      case "Online":
        return t`Online`;
      case "Busy":
        return t`Busy`;
      case "Focus":
        return t`Focus`;
      case "Idle":
        return t`Idle`;
      default:
        return t`Offline`;
    }
  };

  return (
    <Show when={effectiveStatus()?.text}>
      <ProfileCard>
        <Text class="title" size="large">
          <Trans>Status</Trans>
        </Text>
        <Status>{effectiveStatus()?.text ?? fallbackPresenceText()}</Status>
      </ProfileCard>
    </Show>
  );
}

const Status = styled("span", {
  base: {
    ...typography.raw(),
    userSelect: "text",
  },
});
