import {
  JSX,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { Server } from "stoat.js";
import { styled } from "styled-system/jsx";

import { ChannelContextMenu, ServerContextMenu } from "@revolt/app";
import { MessageCache } from "@revolt/app/interface/channels/text/MessageCache";
import { Titlebar } from "@revolt/app/interface/desktop/Titlebar";
import { IncomingCallOverlay } from "@revolt/client/IncomingCallOverlay";
import { PresenceWorker, useClient, useClientLifecycle } from "@revolt/client";
import { State } from "@revolt/client/Controller";
import { NotificationsWorker } from "@revolt/client/NotificationsWorker";
import { useModals } from "@revolt/modal";
import { Navigate, useBeforeLeave, useLocation } from "@revolt/routing";
import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";
import { CircularProgress } from "@revolt/ui";

import { Sidebar } from "./interface/Sidebar";

/**
 * Application layout
 */
const Interface = (props: { children: JSX.Element }) => {
  const state = useState();
  const client = useClient();
  const { openModal } = useModals();
  const { isLoggedIn, lifecycle } = useClientLifecycle();
  const { pathname } = useLocation();
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    onCleanup(() => mediaQuery.removeEventListener("change", update));
  });

  useBeforeLeave((e) => {
    if (!e.defaultPrevented) {
      if (e.to === "/settings") {
        e.preventDefault();
        openModal({
          type: "settings",
          config: "user",
        });
      } else if (typeof e.to === "string") {
        state.layout.setLastActivePath(e.to);
      }
    }
  });

  createEffect(() => {
    if (!isLoggedIn()) {
      state.layout.setNextPath(pathname);
      console.debug("WAITING... currently", lifecycle.state());
    }
  });

  function isDisconnected() {
    return [
      State.Connecting,
      State.Disconnected,
      State.Reconnecting,
      State.Offline,
    ].includes(lifecycle.state());
  }

  return (
    <MessageCache client={client()}>
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          height: "100%",
        }}
      >
        <Titlebar />
        <Switch fallback={<CircularProgress />}>
          <Match when={!isLoggedIn()}>
            <Navigate href="/login" />
          </Match>
          <Match when={lifecycle.loadedOnce()}>
            <Layout
              disconnected={isDisconnected()}
              style={{ "flex-grow": 1, "min-height": 0 }}
              onDragOver={(e) => {
                if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
              }}
              onDrop={(e) => e.preventDefault()}
            >
              <Show
                when={
                  isMobile() &&
                  state.layout.getSectionState(
                    LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
                    !isMobile(),
                  )
                }
              >
                <MobileSidebarScrim
                  onClick={() =>
                    state.layout.setSectionState(
                      LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
                      false,
                    )
                  }
                  aria-label="Close sidebar"
                />
              </Show>

              <Sidebar
                menuGenerator={(target) => ({
                  contextMenu: () => {
                    return (
                      <>
                        {target instanceof Server ? (
                          <ServerContextMenu server={target} />
                        ) : (
                          <ChannelContextMenu channel={target} />
                        )}
                      </>
                    );
                  },
                })}
              />
              <Content
                sidebar={state.layout.getSectionState(
                  LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
                  !isMobile(),
                )}
              >
                {props.children}
              </Content>
            </Layout>
          </Match>
        </Switch>

        <NotificationsWorker />
        <PresenceWorker />
        <IncomingCallOverlay />
      </div>
    </MessageCache>
  );
};

/**
 * Parent container
 */
const Layout = styled("div", {
  base: {
    display: "flex",
    height: "100%",
    minWidth: 0,
    position: "relative",
  },
  variants: {
    disconnected: {
      true: {
        color: "var(--md-sys-color-on-primary-container)",
        background: "var(--md-sys-color-primary-container)",
      },
      false: {
        color: "var(--md-sys-color-outline)",
        background: "var(--md-sys-color-surface-container-high)",
      },
    },
  },
});

/**
 * Main content container
 */
const Content = styled("div", {
  base: {
    background: "var(--md-sys-color-surface-container-low)",

    display: "flex",
    width: "100%",
    minWidth: 0,
  },
  variants: {
    sidebar: {
      false: {
        borderTopLeftRadius: "var(--borderRadius-lg)",
        borderBottomLeftRadius: "var(--borderRadius-lg)",
        overflow: "hidden",

        mdDown: {
          borderTopLeftRadius: "0",
          borderBottomLeftRadius: "0",
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
    zIndex: 9,
    cursor: "pointer",
    background: "rgba(15, 23, 42, 0.5)",
  },
});

export default Interface;
