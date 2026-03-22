import { Match, Show, Switch } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";

import { Dialog, DialogProps } from "@revolt/ui";

import { Modals } from "../types";

/**
 * Modal to notify the user they've been signed out
 */
export function SignedOutModal(
  props: DialogProps & Modals & { type: "signed_out" },
) {
  const reason = () => props.reason ?? "unknown";

  return (
    <Dialog
      show={props.show}
      onClose={props.onClose}
      title={
        <Switch fallback={<Trans>You've been signed out of DawnChat.</Trans>}>
          <Match when={reason() === "disabled"}>
            <Trans>Your account is disabled.</Trans>
          </Match>
          <Match when={reason() === "banned"}>
            <Trans>Your account is banned.</Trans>
          </Match>
          <Match when={reason() === "suspended"}>
            <Trans>Your account is suspended.</Trans>
          </Match>
          <Match when={reason() === "invalid_session"}>
            <Trans>Your session is no longer valid.</Trans>
          </Match>
        </Switch>
      }
      actions={[{ text: <Trans>OK</Trans> }]}
    >
      <Switch
        fallback={
          <p>
            <Trans>
              You have been signed out. Please try logging in again. If this
              keeps happening, contact support.
            </Trans>
          </p>
        }
      >
        <Match when={reason() === "disabled"}>
          <p>
            <Trans>
              This account has been disabled. Access is currently blocked.
            </Trans>
          </p>
        </Match>

        <Match when={reason() === "banned"}>
          <p>
            <Trans>
              This account has been banned and cannot access DawnChat.
            </Trans>
          </p>
        </Match>

        <Match when={reason() === "suspended"}>
          <p>
            <Trans>
              This account is suspended and cannot be used right now.
            </Trans>
          </p>
        </Match>

        <Match when={reason() === "invalid_session"}>
          <p>
            <Trans>
              Your previous session expired or was revoked. Please sign in
              again.
            </Trans>
          </p>
        </Match>
      </Switch>

      <Show when={props.userId}>
        <p>
          <Trans>Account ID:</Trans> {props.userId}
        </p>
      </Show>

      <Show when={props.errorType && props.errorType !== props.reason}>
        <p>
          <Trans>Error code:</Trans> {props.errorType}
        </p>
      </Show>

      <Show when={props.source}>
        <p>
          <Trans>Detected during:</Trans> {props.source}
        </p>
      </Show>
    </Dialog>
  );
}
