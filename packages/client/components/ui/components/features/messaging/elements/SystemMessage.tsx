import {
  JSX,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onMount,
} from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";
import {
  CallStartedSystemMessage,
  ChannelEditSystemMessage,
  ChannelOwnershipChangeSystemMessage,
  ChannelRenamedSystemMessage,
  MessagePinnedSystemMessage,
  SystemMessage as SystemMessageClass,
  TextSystemMessage,
  User,
  UserModeratedSystemMessage,
  UserSystemMessage,
} from "stoat.js";
import { styled } from "styled-system/jsx";

import { useTime } from "@revolt/i18n";
import { time } from "@revolt/markdown/elements";
import { RenderAnchor } from "@revolt/markdown/plugins/anchors";
import { UserMention } from "@revolt/markdown/plugins/mentions";
import { useSmartParams } from "@revolt/routing";
import { useVoice } from "@revolt/rtc";
import { useClient } from "@revolt/client";
import {
  ensureClientApiSocketConnected,
  fetchRemoteCallState,
  getRemoteCallState,
  pushRemoteCallState,
} from "@revolt/common/lib/clientApiSocket";
import { Button } from "@revolt/ui/components/design";
import { formatTime, Time } from "@revolt/ui/components/utils";

interface Props {
  /**
   * System Message
   */
  systemMessage: SystemMessageClass;

  /**
   * Menu generator
   */
  menuGenerator: (user?: User) => JSX.Directives["floating"];

  /**
   * Whether this is rendered within a server
   */
  isServer: boolean;

  /**
   * Channel ID where this message lives
   */
  channelId?: string;

  /**
   * Message ID for generating unique call IDs
   */
  messageId?: string;
}

/**
 * System Message
 */
export function SystemMessage(props: Props) {
  const params = useSmartParams();
  const dayjs = useTime();
  const voice = useVoice();
  const client = useClient();
  const [lastAutoPushed, setLastAutoPushed] = createSignal<
    | {
        key: string;
        status: string;
      }
    | undefined
  >();

  const callSystemMessage = () =>
    props.systemMessage as CallStartedSystemMessage | undefined;

  const callInstanceId = () => {
    const messageId = props.messageId;
    if (!messageId) return "UNKNOWN";

    return messageId.slice(-8).toUpperCase();
  };

  const callStatus = () => {
    const call = callSystemMessage();
    const channelId = props.channelId;
    const callId = props.messageId;
    const currentUserId = client().user?.id;
    const remoteState = getRemoteCallState(channelId, callId);

    if (!call || !channelId || !currentUserId) return "Ended";
    if (remoteState?.status) return remoteState.status;

    return localCallStatus();
  };

  const canStopRinging = () => {
    const call = callSystemMessage();
    const currentUserId = client().user?.id;
    return (
      !!call &&
      !!currentUserId &&
      call.byId === currentUserId &&
      callStatus() === "Ringing"
    );
  };

  const localCallStatus = () => {
    const call = callSystemMessage();
    const channelId = props.channelId;
    const currentUserId = client().user?.id;

    if (!call || !channelId || !currentUserId) return "Ended";

    if (!call.finishedAt) {
      return voice.channel()?.id === channelId ? "Active" : "Ringing";
    }

    if (call.byId !== currentUserId) {
      return "Missed";
    }

    return "Ended";
  };

  onMount(() => {
    ensureClientApiSocketConnected();
  });

  createEffect(() => {
    const channelId = props.channelId;
    const callId = props.messageId;

    if (!channelId || !callId) return;

    void fetchRemoteCallState(channelId, callId);
  });

  async function stopRinging() {
    const channelId = props.channelId;
    const callId = props.messageId;
    const call = callSystemMessage();
    const currentUserId = client().user?.id;
    const channel = channelId ? client().channels.get(channelId) : undefined;

    if (!channelId || !callId || !call || !currentUserId || !channel) return;

    await pushRemoteCallState(channelId, callId, "Ended", {
      startedById: call.byId,
      updatedById: currentUserId,
      channelType:
        channel.type === "DirectMessage" || channel.type === "Group"
          ? channel.type
          : undefined,
    });
  }

  createEffect(() => {
    const channelId = props.channelId;
    const callId = props.messageId;
    const call = callSystemMessage();
    const currentUserId = client().user?.id;
    const channel = channelId ? client().channels.get(channelId) : undefined;
    const remoteState = getRemoteCallState(channelId, callId);

    if (!channelId || !callId || !call || !currentUserId || !channel) return;
    if (channel.type !== "DirectMessage" && channel.type !== "Group") return;
    if (call.byId !== currentUserId) return;

    // Once a call has been marked terminal remotely, do not reopen it from local heuristics.
    if (
      remoteState?.status === "Missed" ||
      remoteState?.status === "Ended"
    ) {
      return;
    }

    // Caller should publish Ringing when a call starts; Active is driven by recipient accept.
    const nextStatus = call.finishedAt != null ? "Ended" : "Ringing";
    const key = `${channelId}:${callId}`;
    const previous = lastAutoPushed();

    if (previous?.key === key && previous.status === nextStatus) {
      return;
    }

    setLastAutoPushed({ key, status: nextStatus });

    void pushRemoteCallState(channelId, callId, nextStatus, {
      startedById: call.byId,
      updatedById: currentUserId,
      channelType: channel.type,
    });
  });

  return (
    <Base>
      <Switch fallback={props.systemMessage.type}>
        <Match when={props.systemMessage.type === "user_added"}>
          <Trans>
            <UserMention
              userId={
                (props.systemMessage as UserModeratedSystemMessage).userId
              }
            />{" "}
            has been added by{" "}
            <UserMention
              userId={(props.systemMessage as UserModeratedSystemMessage).byId}
            />
          </Trans>
        </Match>
        <Match
          when={props.systemMessage.type === "user_left" && !props.isServer}
        >
          <Trans>
            <UserMention
              userId={(props.systemMessage as UserSystemMessage).userId}
            />{" "}
            left the group
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "user_remove"}>
          <Trans>
            <UserMention
              userId={
                (props.systemMessage as UserModeratedSystemMessage).userId
              }
            />{" "}
            has been removed by{" "}
            <UserMention
              userId={(props.systemMessage as UserModeratedSystemMessage).byId}
            />
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "user_kicked"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as UserSystemMessage).userId}
            />{" "}
            has been kicked from the server
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "user_banned"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as UserSystemMessage).userId}
            />{" "}
            has been banned from the server
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "user_joined"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as UserSystemMessage).userId}
            />{" "}
            joined the server
          </Trans>
        </Match>
        <Match
          when={props.systemMessage.type === "user_left" && props.isServer}
        >
          <Trans>
            <UserMention
              userId={(props.systemMessage as UserSystemMessage).userId}
            />{" "}
            left the server
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "channel_renamed"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as ChannelRenamedSystemMessage).byId}
            />{" "}
            updated the group name to{" "}
            <strong>
              {(props.systemMessage as ChannelRenamedSystemMessage).name}
            </strong>
          </Trans>
        </Match>
        <Match
          when={props.systemMessage.type === "channel_description_changed"}
        >
          <Trans>
            <UserMention
              userId={(props.systemMessage as ChannelEditSystemMessage).byId}
            />{" "}
            updated the group description
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "channel_icon_changed"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as ChannelEditSystemMessage).byId}
            />{" "}
            updated the group icon{" "}
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "channel_ownership_changed"}>
          <Trans>
            <UserMention
              userId={
                (props.systemMessage as ChannelOwnershipChangeSystemMessage)
                  .fromId
              }
            />{" "}
            transferred group ownership to{" "}
            <UserMention
              userId={
                (props.systemMessage as ChannelOwnershipChangeSystemMessage)
                  .toId
              }
            />
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "message_pinned"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as MessagePinnedSystemMessage).byId}
            />{" "}
            pinned{" "}
            <RenderAnchor
              href={
                location.origin +
                (params().serverId ? `/server/${params().serverId}` : "") +
                `/channel/${params().channelId}/${(props.systemMessage as MessagePinnedSystemMessage).messageId}`
              }
            />
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "message_unpinned"}>
          <Trans>
            <UserMention
              userId={(props.systemMessage as MessagePinnedSystemMessage).byId}
            />{" "}
            unpinned{" "}
            <RenderAnchor
              href={
                location.origin +
                (params().serverId ? `/server/${params().serverId}` : "") +
                `/channel/${params().channelId}/${(props.systemMessage as MessagePinnedSystemMessage).messageId}`
              }
            />
          </Trans>
        </Match>
        <Match when={props.systemMessage.type === "call_started"}>
          <CallWidget>
            <CallWidgetHeader>
              <CallTitle>
                <Trans>Call</Trans> #{callInstanceId()}
              </CallTitle>
              <CallStatus data-status={callStatus()}>{callStatus()}</CallStatus>
            </CallWidgetHeader>

            <CallMeta>
              <Trans>
                <UserMention
                  userId={(props.systemMessage as CallStartedSystemMessage).byId}
                />{" "}
                started a call
              </Trans>
            </CallMeta>

            <Show when={canStopRinging()}>
              <CallActions>
                <Button variant="tonal" size="sm" onPress={stopRinging}>
                  Stop ringing
                </Button>
              </CallActions>
            </Show>

            <Show
              when={
                (props.systemMessage as CallStartedSystemMessage).finishedAt !=
                null
              }
            >
              <CallMeta>
                <Trans>Duration</Trans>{" "}
                <span
                  class={time()}
                  use:floating={{
                    tooltip: {
                      placement: "top",
                      content: () => (
                        <Time
                          format="datetime"
                          value={
                            (props.systemMessage as CallStartedSystemMessage)
                              .finishedAt
                          }
                        />
                      ),
                      aria: formatTime(dayjs, {
                        format: "datetime",
                        value: (props.systemMessage as CallStartedSystemMessage)
                          .finishedAt,
                      }) as string,
                    },
                  }}
                >
                  <Time
                    value={
                      (props.systemMessage as CallStartedSystemMessage).finishedAt
                    }
                    referenceTime={
                      (props.systemMessage as CallStartedSystemMessage).startedAt
                    }
                    hideSuffix={true}
                    format="relative"
                  />
                </span>
              </CallMeta>
            </Show>
          </CallWidget>
        </Match>
        <Match when={props.systemMessage.type === "text"}>
          {(props.systemMessage as TextSystemMessage).content}
        </Match>
      </Switch>
    </Base>
  );
}

const Base = styled("div", {
  base: {
    minHeight: "20px",
    alignItems: "center",
  },
});

const CallWidget = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: "300px",
    maxWidth: "520px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container)",
  },
});

const CallWidgetHeader = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
});

const CallTitle = styled("span", {
  base: {
    fontWeight: 700,
    color: "var(--md-sys-color-on-surface)",
  },
});

const CallStatus = styled("span", {
  base: {
    fontSize: "12px",
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: "999px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: "var(--md-sys-color-surface-variant)",
    color: "var(--md-sys-color-on-surface-variant)",
    '&[data-status="Active"]': {
      background: "var(--md-sys-color-primary)",
      color: "var(--md-sys-color-on-primary)",
    },
    '&[data-status="Ringing"]': {
      background: "var(--md-sys-color-tertiary-container)",
      color: "var(--md-sys-color-on-tertiary-container)",
    },
    '&[data-status="Missed"]': {
      background: "var(--md-sys-color-error-container)",
      color: "var(--md-sys-color-on-error-container)",
    },
  },
});

const CallMeta = styled("div", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "13px",
  },
});

const CallActions = styled("div", {
  base: {
    display: "flex",
    justifyContent: "flex-end",
  },
});
