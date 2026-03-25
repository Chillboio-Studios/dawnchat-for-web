import { For, Show } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";
import { PublicChannelInvite } from "stoat.js";
import { css, cva } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { IS_DEV, useClient } from "@revolt/client";
import { CONFIGURATION } from "@revolt/common";
import { useModals } from "@revolt/modal";
import { useLocation, useNavigate } from "@revolt/routing";
import {
  Button,
  CategoryButton,
  Column,
  Header,
  iconSize,
  main,
} from "@revolt/ui";

import MdAddCircle from "@material-design-icons/svg/filled/add_circle.svg?component-solid";
import MdExplore from "@material-design-icons/svg/filled/explore.svg?component-solid";
import MdGroups3 from "@material-design-icons/svg/filled/groups_3.svg?component-solid";
import MdHome from "@material-design-icons/svg/filled/home.svg?component-solid";
import MdRateReview from "@material-design-icons/svg/filled/rate_review.svg?component-solid";
import MdSettings from "@material-design-icons/svg/filled/settings.svg?component-solid";
import Wordmark from "../../assets/web/wordmark.svg";

import splashButtons from "./homeSplashButtons.json";

import { HeaderIcon } from "./common/CommonHeader";

type SplashButtonId =
  | "create"
  | "community"
  | "official_invite"
  | "feedback"
  | "settings";

type SplashButtonConfig = {
  id: SplashButtonId;
  column: 1 | 2;
};

const isValidSplashButtonId = (id: unknown): id is SplashButtonId =>
  id === "create" ||
  id === "community" ||
  id === "official_invite" ||
  id === "feedback" ||
  id === "settings";

const isValidSplashButtonConfig = (
  item: unknown,
): item is SplashButtonConfig => {
  if (typeof item !== "object" || item === null) return false;

  const config = item as { id?: unknown; column?: unknown };
  return (
    isValidSplashButtonId(config.id) &&
    (config.column === 1 || config.column === 2)
  );
};

// Resolve splash buttons at module load so config is ready before first render.
const resolvedSplashButtons = (Array.isArray(splashButtons) ? splashButtons : [])
  .filter(isValidSplashButtonConfig)
  .map((button) => ({
    id: button.id,
    column: button.column,
  }));

/**
 * Base layout of the home page (i.e. the header/background)
 */
const Base = styled("div", {
  base: {
    width: "100%",
    display: "flex",
    flexDirection: "column",

    color: "var(--md-sys-color-on-surface)",
  },
});

/**
 * Layout of the content as a whole
 */
const content = cva({
  base: {
    ...main.raw(),

    padding: "48px 0",

    gap: "32px",
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * Layout of the buttons
 */
const Buttons = styled("div", {
  base: {
    gap: "8px",
    padding: "8px",
    display: "flex",
    borderRadius: "var(--borderRadius-lg)",

    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-variant)",
  },
});

/**
 * Make sure the columns are separated
 */
const SeparatedColumn = styled(Column, {
  base: {
    justifyContent: "stretch",
    marginInline: "0.25em",
    width: "260px",
    "& > *": {
      flexGrow: 1,
    },
  },
});

const NotFoundNotice = styled("div", {
  base: {
    width: "100%",
    maxWidth: "560px",
    borderRadius: "var(--borderRadius-md)",
    border: "1px solid var(--md-sys-color-error)",
    background: "var(--md-sys-color-error-container)",
    color: "var(--md-sys-color-on-error-container)",
    padding: "10px 12px",
    textAlign: "center",
    fontWeight: 600,
  },
});

const LogoBackdrop = styled("div", {
  base: {
    padding: "16px 24px",
    borderRadius: "var(--borderRadius-xl)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "color-mix(in srgb, var(--md-sys-color-surface) 88%, white 12%)",
    boxShadow: "var(--shadow-2)",
  },
});

/**
 * Home page
 */
export function HomePage() {
  const { openModal } = useModals();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useClient();

  // check if we're stoat.chat; if so, check if the user is in the Lounge
  const showLoungeButton = CONFIGURATION.IS_STOAT;
  const isInLounge =
    client()!.servers.get("01F7ZSBSFHQ8TA81725KQCSDDP") !== undefined;

  const leftButtons = resolvedSplashButtons.filter(
    (button) => button.column === 1,
  );
  const rightButtons = resolvedSplashButtons.filter(
    (button) => button.column === 2,
  );
  const showNotFoundMessage = () => location.pathname !== "/app";

  const handleJoinLounge = () => {
    client()
      .api.get("/invites/Testers")
      .then((invite) => PublicChannelInvite.from(client(), invite))
      .then((invite) => openModal({ type: "invite", invite }));
  };

  const renderButton = (button: SplashButtonConfig) => {
    switch (button.id) {
      case "create":
        return (
          <CategoryButton
            onClick={() =>
              openModal({
                type: "create_group_or_server",
                client: client()!,
              })
            }
            description={
              <Trans>
                Invite all of your friends, some cool bots, and throw a big
                party.
              </Trans>
            }
            icon={<MdAddCircle />}
          >
            <Trans>Create a group or server</Trans>
          </CategoryButton>
        );
      case "community":
        if (showLoungeButton && isInLounge) {
          return (
            <CategoryButton
              onClick={() => navigate("/server/01F7ZSBSFHQ8TA81725KQCSDDP")}
              description={
                <Trans>
                  You can report issues and discuss improvements with us
                  directly here.
                </Trans>
              }
              icon={<MdGroups3 />}
            >
              <Trans>Go to the DawnChat Lounge</Trans>
            </CategoryButton>
          );
        }

        if (showLoungeButton) {
          return (
            <CategoryButton
              onClick={handleJoinLounge}
              description={
                <Trans>
                  You can report issues and discuss improvements with us
                  directly here.
                </Trans>
              }
              icon={<MdGroups3 />}
            >
              <Trans>Join the DawnChat Lounge</Trans>
            </CategoryButton>
          );
        }

        return (
          <CategoryButton
            disabled
            description={
              <Trans>Discover is coming soon for DawnChat.</Trans>
            }
            icon={<MdExplore />}
          >
            <Trans>Discover DawnChat</Trans>
          </CategoryButton>
        );
      case "official_invite":
        return (
          <CategoryButton
            onClick={() => navigate("/invite/official")}
            description={
              <Trans>Join the official DawnChat server invite.</Trans>
            }
            icon={<MdGroups3 />}
          >
            <Trans>Join Official DawnChat</Trans>
          </CategoryButton>
        );
      case "feedback":
        return (
          <CategoryButton
            onClick={() =>
              openModal({
                type: "settings",
                config: "user",
                context: { page: "feedback" },
              })
            }
            description={
              <Trans>
                Let us know how we can improve our app by giving us feedback.
              </Trans>
            }
            icon={<MdRateReview {...iconSize(22)} />}
          >
            <Trans>Give feedback on DawnChat</Trans>
          </CategoryButton>
        );
      case "settings":
        return (
          <CategoryButton
            onClick={() => openModal({ type: "settings", config: "user" })}
            description={
              <Trans>You can also click the gear icon in the bottom left.</Trans>
            }
            icon={<MdSettings />}
          >
            <Trans>Open settings</Trans>
          </CategoryButton>
        );
    }
  };

  return (
    <Base>
      <Header placement="primary">
        <HeaderIcon>
          <MdHome {...iconSize(22)} />
        </HeaderIcon>
        <Trans>Home</Trans>
      </Header>
      <div use:scrollable={{ class: content() }}>
        <Show when={showNotFoundMessage()}>
          <NotFoundNotice>
            <Trans>404 page could not be found</Trans>
          </NotFoundNotice>
        </Show>
        <Column>
          <LogoBackdrop>
            <img
              src={Wordmark}
              alt="DawnChat"
              class={css({
                width: "240px",
                maxWidth: "min(100%, 92vw)",
                height: "auto",
                display: "block",
                objectFit: "contain",
              })}
            />
          </LogoBackdrop>
        </Column>
        <Buttons>
          <SeparatedColumn>
            <For each={leftButtons}>{(button) => renderButton(button)}</For>
          </SeparatedColumn>
          <SeparatedColumn>
            <For each={rightButtons}>{(button) => renderButton(button)}</For>
          </SeparatedColumn>
        </Buttons>
        <Show when={IS_DEV}>
          <Button onPress={() => navigate("/dev")}>
            Open Development Page
          </Button>
        </Show>
      </div>
    </Base>
  );
}
