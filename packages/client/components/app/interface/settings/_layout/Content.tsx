import { Accessor, JSX, Show } from "solid-js";

import { css, cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { Breadcrumbs, IconButton, Text } from "@revolt/ui";

import MdClose from "@material-design-icons/svg/outlined/close.svg?component-solid";
import MdMenu from "@material-design-icons/svg/outlined/menu.svg?component-solid";

import { SettingsList } from "..";
import { useSettingsNavigation } from "../Settings";

/**
 * Content portion of the settings menu
 */
export function SettingsContent(props: {
  onClose?: () => void;
  children: JSX.Element;
  list: Accessor<SettingsList<unknown>>;
  title: (ctx: SettingsList<never>, key: string) => string;
  page: Accessor<string | undefined>;
  isMobile: Accessor<boolean>;
  onOpenMobileSidebar: () => void;
}) {
  const { navigate } = useSettingsNavigation();

  return (
    <div
      use:scrollable={{
        class: base(),
      }}
    >
      <Show when={props.page()}>
        <InnerContent>
          <InnerColumn>
            <HeaderRow>
              <Show when={props.isMobile()}>
                <IconButton
                  variant="tonal"
                  onPress={props.onOpenMobileSidebar}
                  aria-label="Open settings pages"
                >
                  <MdMenu />
                </IconButton>
              </Show>

              <Text class="title" size="large">
                <Breadcrumbs
                  elements={props.page()!.split("/")}
                  renderElement={(key) =>
                    props.title(props.list() as SettingsList<never>, key)
                  }
                  navigate={(keys) => navigate(keys.join("/"))}
                />
              </Text>
            </HeaderRow>
            {props.children}
            <div class={css({ minHeight: "80px" })} />
          </InnerColumn>
        </InnerContent>
      </Show>
      <Show when={props.onClose}>
        <CloseAction>
          <IconButton variant="tonal" onPress={props.onClose}>
            <MdClose />
          </IconButton>
        </CloseAction>
      </Show>
    </div>
  );
}

/**
 * Base styles
 */
const base = cva({
  base: {
    minWidth: 0,
    flex: "1 1 800px",
    flexDirection: "row",
    display: "flex",
    background: "var(--md-sys-color-surface-container-low)",
    borderStartStartRadius: "30px",
    borderEndStartRadius: "30px",
    mdDown: {
      borderStartStartRadius: "0px",
      borderEndStartRadius: "0px",
      borderRadius: "0px",
      flex: "1 1 auto",
    },

    "& > a": {
      textDecoration: "none",
    },
  },
});

/**
 * Settings pane
 */
const InnerContent = styled("div", {
  base: {
    gap: "13px",
    minWidth: 0,
    width: "100%",
    display: "flex",
    maxWidth: "740px",
    padding: "80px 32px",
    justifyContent: "stretch",
    zIndex: 1,
    mdDown: {
      maxWidth: "none",
      padding: "16px 12px 20px",
    },
  },
});

/**
 * Pane content column
 */
const InnerColumn = styled("div", {
  base: {
    width: "100%",
    gap: "var(--gap-md)",
    display: "flex",
    flexDirection: "column",
    marginBlockEnd: "80px",
    mdDown: {
      marginBlockEnd: "28px",
    },
  },
});

const HeaderRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
});

/**
 * Positioning for close button
 */
const CloseAction = styled("div", {
  base: {
    flexGrow: 1,
    flexShrink: 0,
    padding: "80px 8px",
    visibility: "visible",
    position: "sticky",
    top: 0,
    alignSelf: "flex-start",

    "&:after": {
      content: '"ESC"',
      marginTop: "4px",
      display: "flex",
      justifyContent: "center",
      width: "36px",
      fontWeight: 600,
      color: "var(--md-sys-color-on-surface)",
      fontSize: "0.75rem",
    },
    mdDown: {
      position: "fixed",
      top: "12px",
      right: "12px",
      padding: "0px",
      zIndex: 4,
      "&:after": {
        display: "none",
      },
    },
  },
});
