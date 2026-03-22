import {
  Component,
  JSX,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Channel, Server as ServerI } from "stoat.js";
import { cva } from "styled-system/css";

import {
  CategoryContextMenu,
  ChannelContextMenu,
  ServerSidebarContextMenu,
} from "@revolt/app";
import { useClient, useUser } from "@revolt/client";
import { useModals } from "@revolt/modal";
import { useLocation, useParams, useSmartParams } from "@revolt/routing";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import { IconButton } from "@revolt/ui";
import { Symbol } from "@revolt/ui/components/utils/Symbol";

import { HomeSidebar, ServerList, ServerSidebar } from "./navigation";

/**
 * Left-most channel navigation sidebar
 */
export const Sidebar = (props: {
  /**
   * Menu generator TODO FIXME: remove
   */
  menuGenerator: (t: ServerI | Channel) => JSX.Directives["floating"];
}) => {
  const user = useUser();
  const state = useState();
  const client = useClient();
  const { openModal } = useModals();

  const params = useParams<{ server: string }>();
  const location = useLocation();
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    onCleanup(() => mediaQuery.removeEventListener("change", update));
  });

  const mobileSidebarOpen = () =>
    state.layout.getSectionState(LAYOUT_SECTIONS.PRIMARY_SIDEBAR, !isMobile());

  return (
    <div class={drawer({ mobileOpen: mobileSidebarOpen() })}>
      <Show when={isMobile() && mobileSidebarOpen()}>
        <IconButton
          class={mobileCloseButton()}
          onPress={() =>
            state.layout.setSectionState(
              LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
              false,
            )
          }
          aria-label="Close sidebar"
        >
          <Symbol>close</Symbol>
        </IconButton>
      </Show>
      <ServerList
        orderedServers={state.ordering.orderedServers(client())}
        setServerOrder={state.ordering.setServerOrder}
        unreadConversations={state.ordering
          .orderedConversations(client())
          .filter(
            // TODO: muting channels
            (channel) => channel.unread,
          )}
        user={user()!}
        selectedServer={() => params.server}
        onCreateOrJoinServer={() =>
          openModal({
            type: "create_or_join_server",
            client: client(),
          })
        }
        menuGenerator={props.menuGenerator}
      />
      <Show
        when={
          mobileSidebarOpen() &&
          !location.pathname.startsWith("/discover")
        }
      >
        <Switch fallback={<Home />}>
          <Match when={params.server}>
            <Server />
          </Match>
        </Switch>
      </Show>
    </div>
  );
};

const drawer = cva({
  base: {
    display: "flex",
    flexShrink: 0,

    mdDown: {
      maxWidth: "calc(100% - 56px)",
      height: "100%",
      position: "absolute",
      top: 0,
      left: 0,
      zIndex: 20,
      transition: "transform 0.2s ease",
      background: "var(--md-sys-color-surface-container-low)",
      boxShadow: "0 16px 32px rgba(0, 0, 0, 0.25)",
    },
  },
  variants: {
    mobileOpen: {
      true: {
        mdDown: {
          transform: "translateX(0)",
          pointerEvents: "auto",
        },
      },
      false: {
        mdDown: {
          transform: "translateX(calc(-100% - 8px))",
          pointerEvents: "none",
        },
      },
    },
  },
});

const mobileCloseButton = cva({
  base: {
    display: "none",
    mdDown: {
      display: "inline-flex",
      position: "absolute",
      top: "8px",
      right: "8px",
      zIndex: 25,
      background: "var(--md-sys-color-surface-container-highest)",
      borderRadius: "var(--borderRadius-circle)",
    },
  },
});

/**
 * Render sidebar for home
 */
const Home: Component = () => {
  const params = useSmartParams();
  const client = useClient();
  const state = useState();
  const conversations = createMemo(() =>
    state.ordering.orderedConversations(client()),
  );

  return (
    <HomeSidebar
      conversations={conversations}
      channelId={params().channelId}
      openSavedNotes={(navigate) => {
        // Check whether the saved messages channel exists already
        const channelId = [...client()!.channels.values()].find(
          (channel) => channel.type === "SavedMessages",
        )?.id;

        if (navigate) {
          if (channelId) {
            // Navigate if exists
            navigate(`/channel/${channelId}`);
          } else {
            // If not, try to create one but only if navigating
            client()!
              .user!.openDM()
              .then((channel) => navigate(`/channel/${channel.id}`));
          }
        }

        // Otherwise return channel ID if available
        return channelId;
      }}
    />
  );
};

/**
 * Render sidebar for a server
 */
const Server: Component = () => {
  const { openModal } = useModals();
  const params = useSmartParams();
  const client = useClient();

  /**
   * Resolve the server
   * @returns Server
   */
  const server = () => client()!.servers.get(params().serverId!)!;

  /**
   * Open the server information modal
   */
  function openServerInfo() {
    openModal({
      type: "server_info",
      server: server(),
    });
  }

  /**
   * Open the server settings modal
   */
  function openServerSettings() {
    openModal({
      type: "settings",
      config: "server",
      context: server(),
    });
  }

  return (
    <Show when={server()}>
      <ServerSidebar
        server={server()}
        channelId={params().channelId}
        openServerInfo={openServerInfo}
        openServerSettings={openServerSettings}
        menuGenerator={(target) => ({
          contextMenu: () =>
            target instanceof Channel ? (
              <ChannelContextMenu channel={target} />
            ) : target instanceof ServerI ? (
              <ServerSidebarContextMenu server={target} />
            ) : (
              <CategoryContextMenu server={server()} category={target} />
            ),
        })}
      />
    </Show>
  );
};
