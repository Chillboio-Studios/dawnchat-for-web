import { Show, createSignal } from "solid-js";

import { ServerMember, User } from "stoat.js";
import { css } from "styled-system/css";
import { styled } from "styled-system/jsx";

import { useLingui } from "@lingui-solid/solid/macro";
import { Tooltip } from "@revolt/ui";
import { getEffectiveUserPresence } from "@revolt/client";
import { Avatar, Ripple, UserStatus, typography } from "../../design";
import { Row } from "../../layout";

export function ProfileBanner(props: {
  user: User;
  member?: ServerMember;
  bannerUrl?: string;
  onClick?: (e: MouseEvent) => void;
  onClickAvatar?: (e: MouseEvent) => void;
  width: 2 | 3;
}) {
  const { t } = useLingui();

  const [isCopied, setIsCopied] = createSignal(false);

  function copyUsername() {
    navigator.clipboard.writeText(
      `${props.user.username}#${props.user.discriminator}`,
    );
  }

  function onUsernameClick(e: MouseEvent) {
    e.stopPropagation();
    copyUsername();
    setIsCopied(true);

    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  }

  return (
    <Banner
      style={{
        "background-image": `linear-gradient(rgba(0, 0, 0, 0.2),rgba(0, 0, 0, 0.7)), url('${props.bannerUrl}')`,
      }}
      isLink={typeof props.onClick !== "undefined"}
      onClick={props.onClick}
      width={props.width}
    >
      <Show when={typeof props.onClick !== "undefined"}>
        <Ripple />
      </Show>

      <Row align gap="lg">
        <Avatar
          src={props.user.animatedAvatarURL}
          size={48}
          holepunch="bottom-right"
          onClick={props.onClickAvatar}
          interactive={props.user.avatar && !!props.onClickAvatar}
          overlay={
            <UserStatus.Graphic status={getEffectiveUserPresence(props.user)} />
          }
        />
        <UserShort>
          <Show
            when={
              (props.member?.displayName ?? props.user.displayName) !==
              props.user.username
            }
          >
            <Row align gap="xs">
              <span class={css({ fontWeight: 600 })}>
                {props.member?.displayName ?? props.user.displayName}
              </span>
              <Show when={props.user.bot}>
                <BotTag>{t`Bot`}</BotTag>
              </Show>
            </Row>
          </Show>
          <Tooltip
            content={isCopied() ? t`Copied!` : t`Click to copy username`}
            placement="top"
          >
            <Row align gap="xs">
              <span onClick={onUsernameClick}>
                {props.user.username}
                <span class={css({ fontWeight: 200 })}>
                  #{props.user.discriminator}
                </span>
              </span>
              <Show
                when={
                  props.user.bot &&
                  (props.member?.displayName ?? props.user.displayName) ===
                    props.user.username
                }
              >
                <BotTag>{t`Bot`}</BotTag>
              </Show>
            </Row>
          </Tooltip>
        </UserShort>
      </Row>
    </Banner>
  );
}

const Banner = styled("div", {
  base: {
    // for <Ripple />:
    position: "relative",

    userSelect: "none",

    height: "120px",
    padding: "var(--gap-lg)",

    display: "flex",
    flexDirection: "column",
    justifyContent: "end",

    backgroundSize: "cover",
    backgroundPosition: "center",

    borderRadius: "var(--borderRadius-xl)",

    color: "white",
  },
  variants: {
    width: {
      3: {
        gridColumn: "1 / 4",
      },
      2: {
        gridColumn: "1 / 3",
      },
    },
    isLink: {
      true: {
        cursor: "pointer",
      },
    },
  },
});

const UserShort = styled("div", {
  base: {
    ...typography.raw(),

    display: "flex",
    lineHeight: "1em",
    gap: "var(--gap-xs)",
    flexDirection: "column",
    _hover: {
      textDecoration: "underline",
    },
  },
});

const BotTag = styled("span", {
  base: {
    paddingX: "6px",
    lineHeight: "18px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    background: "rgba(255, 255, 255, 0.24)",
    border: "1px solid rgba(255, 255, 255, 0.4)",
    color: "white",
  },
});
