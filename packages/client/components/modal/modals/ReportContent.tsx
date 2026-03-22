import { createFormControl, createFormGroup } from "solid-forms";
import { For, Match, Switch } from "solid-js";

import { Trans, useLingui } from "@lingui-solid/solid/macro";
import { API, Message as MessageI, Server, User } from "stoat.js";
import { cva } from "styled-system/css";

import { Message } from "@revolt/app";
import {
  Avatar,
  Column,
  Dialog,
  DialogProps,
  Form2,
  Initials,
} from "@revolt/ui";

import { useModals } from "..";
import { Modals } from "../types";

const CONTENT_REPORT_REASONS: API.ContentReportReason[] = [
  "Illegal",
  "IllegalGoods",
  "IllegalExtortion",
  "IllegalPornography",
  "IllegalHacking",
  "ExtremeViolence",
  "PromotesHarm",
  "UnsolicitedSpam",
  "Raid",
  "SpamAbuse",
  "ScamsFraud",
  "Malware",
  "Harassment",
  "NoneSpecified",
];

const USER_REPORT_REASONS: API.UserReportReason[] = [
  "UnsolicitedSpam",
  "SpamAbuse",
  "InappropriateProfile",
  "Impersonation",
  "BanEvasion",
  "Underage",
  "NoneSpecified",
];

/**
 * Modal to report content
 */
export function ReportContentModal(
  props: DialogProps & Modals & { type: "report_content" },
) {
  const { t } = useLingui();
  const { showError } = useModals();

  const reasonDescriptions: Record<
    API.ContentReportReason | API.UserReportReason,
    string
  > = {
    Illegal: t`This content appears to break one or more laws.`,
    IllegalGoods: t`This involves drugs or other illegal goods.`,
    IllegalExtortion: t`This includes extortion, threats, or blackmail.`,
    IllegalPornography: t`This includes revenge porn or underage sexual content.`,
    IllegalHacking: t`This includes illegal hacking, cracking, or exploit activity.`,
    ExtremeViolence: t`This contains extreme violence, gore, or animal cruelty.`,
    PromotesHarm: t`This promotes self-harm, violence, or dangerous behavior.`,
    UnsolicitedSpam: t`This is unsolicited advertising or repeated spam.`,
    Raid: t`This is part of a raid or coordinated spam attack.`,
    SpamAbuse: t`This is spam or another form of platform abuse.`,
    ScamsFraud: t`This appears to be a scam or fraud attempt.`,
    Malware: t`This includes malware, phishing, or malicious links/files.`,
    Harassment: t`This includes harassment, bullying, or targeted abuse.`,
    NoneSpecified: t`Other`,

    InappropriateProfile: t`This user's profile contains inappropriate content.`,
    Impersonation: t`This user is impersonating another person, group, or brand.`,
    BanEvasion: t`This user appears to be evading a previous ban.`,
    Underage: t`This user appears to be below the minimum age for the platform.`,
  };

  const group = createFormGroup({
    category: createFormControl("", { required: true }),
    detail: createFormControl(""),
  });

  const reasonLabels: Record<
    API.ContentReportReason | API.UserReportReason,
    string
  > = {
    Illegal: t`Illegal content`,
    IllegalGoods: t`Illegal goods`,
    IllegalExtortion: t`Extortion or blackmail`,
    IllegalPornography: t`Revenge or underage sexual content`,
    IllegalHacking: t`Illegal hacking`,
    ExtremeViolence: t`Extreme violence or gore`,
    PromotesHarm: t`Promotes harm`,
    UnsolicitedSpam: t`Unsolicited ads or spam`,
    Raid: t`Raid or coordinated spam`,
    SpamAbuse: t`Spam or platform abuse`,
    ScamsFraud: t`Scams or fraud`,
    Malware: t`Malware or phishing`,
    Harassment: t`Harassment or bullying`,
    NoneSpecified: t`Other`,

    InappropriateProfile: t`Inappropriate profile`,
    Impersonation: t`Impersonation`,
    BanEvasion: t`Ban evasion`,
    Underage: t`Underage account`,
  };

  const reasons =
    // eslint-disable-next-line solid/reactivity
    props.target instanceof User ? USER_REPORT_REASONS : CONTENT_REPORT_REASONS;

  async function onSubmit() {
    try {
      const category = group.controls.category.value;
      const detail = group.controls.detail.value;

      if (!category) {
        throw new Error(t`Please select a reason before submitting your report.`);
      }

      if (category === "NoneSpecified" && !detail.trim()) {
        throw new Error(
          t`Please provide additional details when selecting Other.`,
        );
      }

      await props.client.api.post("/safety/report", {
        content:
          props.target instanceof User
            ? {
                type: "User",
                id: props.target.id,
                report_reason: category as API.UserReportReason,
                message_id: props.contextMessage?.id,
              }
            : props.target instanceof Server
              ? {
                  type: "Server",
                  id: props.target.id,
                  report_reason: category as API.ContentReportReason,
                }
              : {
                  type: "Message",
                  id: props.target.id,
                  report_reason: category as API.ContentReportReason,
                },
        additional_context: detail,
      });
      props.onClose();
    } catch (error) {
      showError(error);
    }
  }

  const submit = Form2.useSubmitHandler(group, onSubmit);

  return (
    <Dialog
      show={props.show}
      onClose={props.onClose}
      title={
        <Switch>
          <Match when={props.target instanceof User}>
            <Trans>Tell us what's wrong with this user</Trans>
          </Match>
          <Match when={props.target instanceof Server}>
            <Trans>Tell us what's wrong with this server</Trans>
          </Match>
          <Match when={props.target instanceof MessageI}>
            <Trans>Tell us what's wrong with this message</Trans>
          </Match>
        </Switch>
      }
      actions={[
        { text: <Trans>Cancel</Trans> },
        {
          text: <Trans>Report</Trans>,
          onClick: () => {
            onSubmit();
            return false;
          },
          isDisabled: !Form2.canSubmit(group),
        },
      ]}
      isDisabled={group.isPending}
    >
      <form onSubmit={submit}>
        <Column>
          <div class={contentContainer()}>
            {props.target instanceof User ? (
              <Column align>
                <Avatar src={props.target.animatedAvatarURL} size={64} />
                {props.target.displayName}
              </Column>
            ) : props.target instanceof Server ? (
              <Column align>
                <Avatar
                  src={props.target.animatedIconURL}
                  fallback={<Initials input={props.target.name} />}
                  size={64}
                />
                {props.target.name}
              </Column>
            ) : (
              <Message message={props.target as never} />
            )}
          </div>

          <Column gap="sm">
            <div class={reasonPrompt()}>
              <Trans>Select the reason that best matches this report.</Trans>
            </div>
            <div class={reasonList()}>
              <For each={reasons}>
                {(value) => (
                  <label
                    class={reasonOption({
                      active: group.controls.category.value === value,
                    })}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={group.controls.category.value === value}
                      onChange={(event) => {
                        group.controls.category.setValue(event.currentTarget.value);
                        group.controls.category.markDirty(true);
                      }}
                    />
                    <div class={reasonText()}>
                      <span class={reasonTitle()}>{reasonLabels[value]}</span>
                      <span class={reasonDescription()}>
                        {reasonDescriptions[value]}
                      </span>
                    </div>
                  </label>
                )}
              </For>
            </div>
          </Column>

          {/* TODO: use TextEditor? */}
          <Form2.TextField
            name="detail"
            control={group.controls.detail}
            label={t`Additional details`}
          />
        </Column>
      </form>
    </Dialog>
  );
}

const contentContainer = cva({
  base: {
    maxWidth: "100%",
    maxHeight: "80vh",
    overflowY: "hidden",
    "& > div": {
      marginTop: "0 !important",
      pointerEvents: "none",
      userSelect: "none",
    },
  },
});

const reasonList = cva({
  base: {
    display: "grid",
    gap: "8px",
  },
});

const reasonPrompt = cva({
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const reasonOption = cva({
  base: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",
    padding: "10px",
    cursor: "pointer",
    background: "var(--md-sys-color-surface-container-high)",
  },
  variants: {
    active: {
      true: {
        borderColor: "var(--md-sys-color-primary)",
        background: "var(--md-sys-color-primary-container)",
      },
    },
  },
});

const reasonText = cva({
  base: {
    display: "grid",
    gap: "2px",
    minWidth: 0,
  },
});

const reasonTitle = cva({
  base: {
    fontWeight: "600",
    color: "var(--md-sys-color-on-surface)",
  },
});

const reasonDescription = cva({
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface-variant)",
    lineHeight: "1.3",
  },
});
