import { Accessor, Match, Setter, Show, Switch } from "solid-js";

import { Trans, useLingui } from "@lingui-solid/solid/macro";
import { Channel } from "stoat.js";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { getEffectiveUserPresence, useClient } from "@revolt/client";
import { TextWithEmoji } from "@revolt/markdown";
import { useModals } from "@revolt/modal";
import { useVoice } from "@revolt/rtc";
import {
  getAllRemoteCallStates,
  pushRemoteCallState,
} from "@revolt/common/lib/clientApiSocket";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import {
  Button,
  IconButton,
  NonBreakingText,
  OverflowingText,
  Spacer,
  UserStatus,
  typography,
} from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import MdGroup from "@material-design-icons/svg/outlined/group.svg?component-solid";
import MdPersonAdd from "@material-design-icons/svg/outlined/person_add.svg?component-solid";
import MdSettings from "@material-design-icons/svg/outlined/settings.svg?component-solid";

import MdKeep from "../../svg/keep.svg?component-solid";
import { HeaderIcon } from "../common/CommonHeader";

import { SidebarState } from "./text/TextChannel";

interface Props {
  /**
   * Channel to render header for
   */
  channel: Channel;

  /**
   * Sidebar state
   */
  sidebarState?: Accessor<SidebarState>;

  /**
   * Set sidebar state
   */
  setSidebarState?: Setter<SidebarState>;
}

/**
 * Common channel header component
 */
export function ChannelHeader(props: Props) {
  const { openModal } = useModals();
  const client = useClient();
  const voice = useVoice();
  const { t } = useLingui();
  const state = useState();

  const canUseVoiceHeaderButton = () =>
    props.channel.isVoice && props.channel.havePermission("Connect");

  const inThisCall = () => voice.channel()?.id === props.channel.id;

  const searchValue = () => {
    if (!props.sidebarState) return null;

    const state = props.sidebarState();
    if (state.state === "search") {
      return state.query;
    } else {
      return "";
    }
  };

  return (
    <>
      <Switch>
        <Match
          when={
            props.channel.type === "TextChannel" ||
            props.channel.type === "Group"
          }
        >
          <HeaderIcon>
            <Symbol>grid_3x3</Symbol>
          </HeaderIcon>
          <NonBreakingText
            class={typography({ class: "title", size: "medium" })}
            onClick={() =>
              openModal({
                type: "channel_info",
                channel: props.channel,
              })
            }
          >
            <TextWithEmoji content={props.channel.name!} />
          </NonBreakingText>
          <Show when={props.channel.description}>
            <Divider />
            <a
              class={descriptionLink}
              onClick={() =>
                openModal({
                  type: "channel_info",
                  channel: props.channel,
                })
              }
              use:floating={{
                tooltip: {
                  placement: "bottom",
                  content: t`Click to show full description`,
                },
              }}
            >
              <OverflowingText
                class={typography({ class: "title", size: "small" })}
              >
                <TextWithEmoji
                  content={props.channel.description?.split("\n").shift()}
                />
              </OverflowingText>
            </a>
          </Show>
        </Match>
        <Match when={props.channel.type === "DirectMessage"}>
          <HeaderIcon>
            <Symbol>alternate_email</Symbol>
          </HeaderIcon>
          <TextWithEmoji content={props.channel.recipient?.username} />
          <UserStatus
            status={getEffectiveUserPresence(props.channel.recipient)}
            size="8px"
          />
        </Match>
        <Match when={props.channel.type === "SavedMessages"}>
          <HeaderIcon>
            <Symbol>note_stack</Symbol>
          </HeaderIcon>
          <Trans>Saved Notes</Trans>
        </Match>
      </Switch>

      <Spacer />

      <Show
        when={
          (props.channel.type === "Group" || props.channel.serverId) &&
          props.channel.orPermission("ManageChannel", "ManagePermissions")
        }
      >
        <IconButton
          onPress={() =>
            openModal({
              type: "settings",
              config: "channel",
              context: props.channel,
            })
          }
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`Channel Settings`,
            },
          }}
        >
          <MdSettings />
        </IconButton>
      </Show>

      <Show when={props.channel.type === "Group"}>
        <Button
          variant="text"
          size="icon"
          onPress={() =>
            openModal({
              type: "add_members_to_group",
              group: props.channel,
              client: client(),
            })
          }
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`Add friends to group`,
            },
          }}
        >
          <MdPersonAdd />
        </Button>
      </Show>

      <Show when={canUseVoiceHeaderButton()}>
        <IconButton
          class={mobileCallButton}
          onPress={async () => {
            if (inThisCall()) {
              voice.disconnect();
              return;
            }

            const currentUserId = client().user?.id;
            const channelType =
              props.channel.type === "DirectMessage" ||
              props.channel.type === "Group"
                ? props.channel.type
                : undefined;

            const activeRingForCaller =
              currentUserId && channelType
                ? getAllRemoteCallStates().find(
                    (item) =>
                      item.channelId === props.channel.id &&
                      item.status === "Ringing" &&
                      item.startedById === currentUserId,
                  )
                : undefined;

            const callId =
              activeRingForCaller?.callId ??
              `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

            try {
              await voice.connect(props.channel);

              // For DM/Group calls, publish a Ringing state immediately so recipients
              // and late joiners receive it from websocket snapshots/updates.
              if (currentUserId && channelType) {
                await pushRemoteCallState(props.channel.id, callId, "Ringing", {
                  startedById: currentUserId,
                  updatedById: currentUserId,
                  channelType,
                });
              }
            } catch {
              if (currentUserId && channelType) {
                await pushRemoteCallState(props.channel.id, callId, "Ended", {
                  startedById: currentUserId,
                  updatedById: currentUserId,
                  channelType,
                });
              }

              // Ignore transient call connect errors; voice subsystem handles user feedback.
            }
          }}
          use:floating={{
            tooltip: {
              placement: "bottom",
              // Keep this plain text until catalogs are rebuilt for new i18n message IDs.
              content: inThisCall() ? "Leave" : "Call",
            },
          }}
        >
          <Symbol>{inThisCall() ? "call_end" : "call"}</Symbol>
        </IconButton>
      </Show>

      <Show when={props.sidebarState}>
        <IconButton
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`View pinned messages`,
            },
          }}
          onPress={() =>
            props.sidebarState!().state === "pins"
              ? props.setSidebarState!({
                  state: "default",
                })
              : props.setSidebarState!({
                  state: "pins",
                })
          }
        >
          <MdKeep />
        </IconButton>
      </Show>

      <Show when={props.sidebarState && props.channel.type !== "SavedMessages"}>
        <IconButton
          onPress={() => {
            const mobileViewport =
              typeof window !== "undefined" &&
              window.matchMedia("(max-width: 768px)").matches;

            const defaultOpen = !mobileViewport;

            if (props.sidebarState!().state !== "default") {
              state.layout.setSectionState(
                LAYOUT_SECTIONS.MEMBER_SIDEBAR,
                true,
                defaultOpen,
              );

              props.setSidebarState!({
                state: "default",
              });

              return;
            }

            const isOpen = state.layout.getSectionState(
              LAYOUT_SECTIONS.MEMBER_SIDEBAR,
              defaultOpen,
            );

            state.layout.setSectionState(
              LAYOUT_SECTIONS.MEMBER_SIDEBAR,
              !isOpen,
              defaultOpen,
            );

            if (mobileViewport && !isOpen) {
              state.layout.setSectionState(
                LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
                false,
                false,
              );
            }
          }}
          use:floating={{
            tooltip: {
              placement: "bottom",
              content: t`View members`,
            },
          }}
        >
          <MdGroup />
        </IconButton>
      </Show>

      <Show when={searchValue() !== null}>
        <input
          class={css({
            height: "40px",
            width: "240px",
            paddingInline: "16px",
            borderRadius: "var(--borderRadius-full)",
            background: "var(--md-sys-color-surface-container-high)",
          })}
          placeholder="Search messages..."
          value={searchValue()!}
          onChange={(e) =>
            e.currentTarget.value
              ? props.setSidebarState!({
                  state: "search",
                  query: e.currentTarget.value,
                })
              : props.setSidebarState!({
                  state: "default",
                })
          }
        />
      </Show>
    </>
  );
}

/**
 * Vertical divider between name and topic
 */
const Divider = styled("div", {
  base: {
    height: "20px",
    margin: "0px 5px",
    paddingLeft: "1px",
    backgroundColor: "var(--md-sys-color-outline-variant)",
  },
});

/**
 * Link for the description
 */
const descriptionLink = css({
  minWidth: 0,
});

const mobileCallButton = css({
  display: "none",
  "@media (max-width: 768px)": {
    display: "inline-flex",
  },
});
