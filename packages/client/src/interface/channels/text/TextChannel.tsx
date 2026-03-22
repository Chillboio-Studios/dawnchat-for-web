import {
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import { cva } from "styled-system/css";
import { styled } from "styled-system/jsx";
import { decodeTime, ulid } from "ulid";

import { DraftMessages, Messages } from "@revolt/app";
import { useClient } from "@revolt/client";
import { Keybind, KeybindAction, createKeybind } from "@revolt/keybinds";
import { useVoice } from "@revolt/rtc";
import { useNavigate, useSmartParams } from "@revolt/routing";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import {
  BelowFloatingHeader,
  Header,
  IconButton,
  NewMessages,
  Text,
  TypingIndicator,
  main,
} from "@revolt/ui";
import { VoiceChannelCallCardMount } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { ChannelHeader } from "../ChannelHeader";
import { ChannelPageProps } from "../ChannelPage";

import { MessageComposition } from "./Composition";
import { MemberSidebar } from "./MemberSidebar";
import { TextSearchSidebar } from "./TextSearchSidebar";

/**
 * State of the channel sidebar
 */
export type SidebarState =
  | {
      state: "search";
      query: string;
    }
  | {
      state: "pins";
    }
  | {
      state: "default";
    };

/**
 * Channel component
 */
export function TextChannel(props: ChannelPageProps) {
  const state = useState();
  const client = useClient();
  const voice = useVoice();

  // Last unread message id
  const [lastId, setLastId] = createSignal<string>();

  // Read highlighted message id from parameters
  const params = useSmartParams();
  const navigate = useNavigate();

  /**
   * Message id to be highlighted
   * @returns Message Id
   */
  const highlightMessageId = () => params().messageId;

  const canConnect = () =>
    props.channel.isVoice && props.channel.havePermission("Connect");

  const hasActiveCallInChannel = () => voice.channel()?.id === props.channel.id;

  // Get a reference to the message box's load latest function
  let jumpToBottomRef: ((nearby?: string) => void) | undefined;

  // Get a reference to the message list's "end status"
  let atEndRef: (() => boolean) | undefined;

  // Store last unread message id
  createEffect(
    on(
      () => props.channel.id,
      (id) =>
        setLastId(
          props.channel.unread
            ? (client().channelUnreads.get(id)?.lastMessageId as string)
            : undefined,
        ),
    ),
  );

  // Mark channel as read whenever it is marked as unread
  createEffect(
    on(
      // must be at the end of the conversation
      () => props.channel.unread && (atEndRef ? atEndRef() : true),
      (unread) => {
        if (unread) {
          if (document.hasFocus()) {
            // acknowledge the message
            props.channel.ack();
          } else {
            // otherwise mark this location as the last read location
            if (!lastId()) {
              // (taking away one second from the seed)
              setLastId(ulid(decodeTime(props.channel.lastMessageId!) - 1));
            }
          }
        }
      },
    ),
  );

  // Mark as read on re-focus
  function onFocus() {
    if (props.channel.unread && (atEndRef ? atEndRef() : true)) {
      props.channel.ack();
    }
  }

  document.addEventListener("focus", onFocus);
  onCleanup(() => document.removeEventListener("focus", onFocus));

  // Register ack/jump latest
  createKeybind(KeybindAction.CHAT_JUMP_END, () => {
    // Mark channel as read if not already
    if (props.channel.unread) {
      props.channel.ack();
    }

    // Clear the last unread id
    if (lastId()) {
      setLastId(undefined);
    }

    // Scroll to the bottom
    jumpToBottomRef?.();
  });

  // Sidebar scroll target
  let sidebarScrollTargetElement!: HTMLDivElement;

  // Sidebar state
  const [sidebarState, setSidebarState] = createSignal<SidebarState>({
    state: "default",
  });
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    onCleanup(() => mediaQuery.removeEventListener("change", update));
  });

  // todo: in the future maybe persist per ID?
  createEffect(
    on(
      () => props.channel.id,
      () => setSidebarState({ state: "default" }),
    ),
  );

  const memberSidebarOpen = () =>
    state.layout.getSectionState(LAYOUT_SECTIONS.MEMBER_SIDEBAR, !isMobile());

  const showSidebar = () =>
    (memberSidebarOpen() && props.channel.type !== "SavedMessages") ||
    sidebarState().state !== "default";

  function closeSidebar() {
    if (sidebarState().state !== "default") {
      setSidebarState({ state: "default" });
      return;
    }

    state.layout.setSectionState(LAYOUT_SECTIONS.MEMBER_SIDEBAR, false, false);
  }

  return (
    <>
      <Header placement="primary">
        <ChannelHeader
          channel={props.channel}
          sidebarState={sidebarState}
          setSidebarState={setSidebarState}
        />
      </Header>
      <Content>
        <Show when={isMobile() && showSidebar()}>
          <MobileSidebarScrim
            onClick={closeSidebar}
            aria-label="Close members sidebar"
          />
        </Show>

        <main class={main()}>
          <Show
            when={canConnect()}
            fallback={
              <BelowFloatingHeader>
                <div>
                  <NewMessages
                    lastId={lastId}
                    jumpBack={() => navigate(lastId()!)}
                    dismiss={() => setLastId()}
                  />
                </div>
              </BelowFloatingHeader>
            }
          >
            <Show
              when={!isMobile() || hasActiveCallInChannel()}
              fallback={
                <BelowFloatingHeader>
                  <div>
                    <Text
                      class="label"
                      style={{
                        padding: "10px 14px",
                        color: "var(--md-sys-color-on-surface-variant)",
                      }}
                    >
                      Tap the phone button in the header to join this call.
                    </Text>
                  </div>
                </BelowFloatingHeader>
              }
            >
              <VoiceChannelCallCardMount channel={props.channel} />
            </Show>
          </Show>

          <Messages
            channel={props.channel}
            lastReadId={lastId}
            pendingMessages={(pendingProps) => (
              <DraftMessages
                channel={props.channel}
                tail={pendingProps.tail}
                sentIds={pendingProps.ids}
              />
            )}
            typingIndicator={
              <TypingIndicator
                users={props.channel.typing}
                ownId={client().user!.id}
              />
            }
            highlightedMessageId={highlightMessageId}
            clearHighlightedMessage={() => navigate(".")}
            atEndRef={(ref) => (atEndRef = ref)}
            jumpToBottomRef={(ref) => (jumpToBottomRef = ref)}
          />

          <MessageComposition
            channel={props.channel}
            onMessageSend={() => jumpToBottomRef?.()}
          />
        </main>
        <Show when={showSidebar()}>
          <div
            ref={sidebarScrollTargetElement}
            use:scrollable={{
              direction: "y",
              showOnHover: true,
              class: sidebar({
                mobileOpen: showSidebar(),
                expanded: sidebarState().state !== "default",
              }),
            }}
          >
            <Show when={isMobile()}>
              <MobileSidebarHeader>
                <Text class="label" size="large">
                  Members
                </Text>
                <IconButton onPress={closeSidebar} aria-label="Close members">
                  <Symbol>close</Symbol>
                </IconButton>
              </MobileSidebarHeader>
            </Show>

            <Switch
              fallback={
                <MemberSidebar
                  channel={props.channel}
                  scrollTargetElement={sidebarScrollTargetElement}
                />
              }
            >
              <Match when={sidebarState().state === "search"}>
                <WideSidebarContainer>
                  <SidebarTitle>
                    <Text class="label" size="large">
                      Search Results
                    </Text>
                  </SidebarTitle>
                  <TextSearchSidebar
                    channel={props.channel}
                    query={{
                      query: (sidebarState() as { query: string }).query,
                    }}
                  />
                </WideSidebarContainer>
              </Match>
              <Match when={sidebarState().state === "pins"}>
                <WideSidebarContainer>
                  <SidebarTitle>
                    <Text class="label" size="large">
                      Pinned Messages
                    </Text>
                  </SidebarTitle>
                  <TextSearchSidebar
                    channel={props.channel}
                    query={{ pinned: true, sort: "Latest" }}
                  />
                </WideSidebarContainer>
              </Match>
            </Switch>

            <Show when={sidebarState().state !== "default"}>
              <Keybind
                keybind={KeybindAction.CLOSE_SIDEBAR}
                onPressed={() => setSidebarState({ state: "default" })}
              />
            </Show>
          </div>
        </Show>
      </Content>
    </>
  );
}

/**
 * Main content row layout
 */
const Content = styled("div", {
  base: {
    display: "flex",
    position: "relative",
    flexDirection: "row",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
  },
});

/**
 * Base styles
 */
const sidebar = cva({
  base: {
    flexShrink: 0,
    width: "var(--layout-width-channel-sidebar)",
    background: "var(--md-sys-color-surface-container-low)",
    // margin: "var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    // color: "var(--colours-sidebar-channels-foreground)",
    // background: "var(--colours-sidebar-channels-background)",

    mdDown: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      // Keep member drawer above all in-content mobile UI; overlays still use higher layers.
      zIndex: 150,
      width: "min(100vw, 360px)",
      maxWidth: "100vw",
      borderRadius: 0,
      boxShadow: "-16px 0 32px rgba(0, 0, 0, 0.25)",
      transition: "transform 0.2s ease",
    },
  },
  variants: {
    expanded: {
      true: {
        width: "360px",
      },
    },
    mobileOpen: {
      true: {
        mdDown: {
          transform: "translateX(0)",
          pointerEvents: "auto",
        },
      },
      false: {
        mdDown: {
          transform: "translateX(calc(100% + 8px))",
          pointerEvents: "none",
        },
      },
    },
  },
});

const MobileSidebarScrim = styled("button", {
  base: {
    border: "none",
    padding: "0",
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 140,
    cursor: "pointer",
    background: "rgba(15, 23, 42, 0.5)",
  },
});

const MobileSidebarHeader = styled("div", {
  base: {
    display: "none",
    mdDown: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "var(--gap-md)",
      borderBottom: "1px solid var(--md-sys-color-outline-variant)",
      background: "var(--md-sys-color-surface-container-low)",
      position: "sticky",
      top: 0,
      zIndex: 1,
    },
  },
});

/**
 * Container styles
 */
const WideSidebarContainer = styled("div", {
  base: {
    paddingRight: "var(--gap-md)",
    width: "360px",
  },
});

/**
 * Sidebar title
 */
const SidebarTitle = styled("div", {
  base: {
    padding: "var(--gap-md)",
    color: "var(--md-sys-color-on-surface)",
  },
});
