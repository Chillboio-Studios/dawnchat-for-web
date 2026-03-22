import {
  BiRegularChevronLeft,
  BiRegularChevronRight,
  BiRegularMenu,
} from "solid-icons/bi";
import { JSX, Match, Switch, createSignal, onCleanup, onMount } from "solid-js";

import { useLingui } from "@lingui-solid/solid/macro";
import { css } from "styled-system/css";

import { useState } from "@revolt/state";
import { LAYOUT_SECTIONS } from "@revolt/state/stores/Layout";

/**
 * Wrapper for header icons which adds the chevron on the
 * correct side for toggling sidebar (if on desktop) and
 * the hamburger icon to open sidebar (if on mobile).
 */
export function HeaderIcon(props: { children: JSX.Element }) {
  const state = useState();
  const { t } = useLingui();
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    onCleanup(() => mediaQuery.removeEventListener("change", update));
  });

  const sidebarOpen = () =>
    state.layout.getSectionState(LAYOUT_SECTIONS.PRIMARY_SIDEBAR, !isMobile());

  return (
    <div
      class={container}
      onClick={() =>
        state.layout.setSectionState(
          LAYOUT_SECTIONS.PRIMARY_SIDEBAR,
          !sidebarOpen(),
          !isMobile(),
        )
      }
      use:floating={{
        tooltip: {
          placement: "bottom",
          content: t`Toggle main sidebar`,
        },
      }}
    >
      <Switch fallback={<BiRegularChevronRight size={20} />}>
        <Match when={isMobile()}>
          <BiRegularMenu size={20} />
        </Match>
        <Match when={sidebarOpen()}>
          <BiRegularChevronLeft size={20} />
        </Match>
      </Switch>
      {props.children}
    </div>
  );
}

const container = css({
  display: "flex",
  cursor: "pointer",
  alignItems: "center",
});
