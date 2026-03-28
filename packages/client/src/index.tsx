/**
 * Configure contexts and render App
 */
import "./sentry";
import "./desktopUrlShim";

import { ErrorBoundary, JSX, Show, onMount } from "solid-js";
import { render } from "solid-js/web";

import { attachDevtoolsOverlay } from "@solid-devtools/overlay";
import { Navigate, Route, Router, useParams } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import "material-symbols";
import "mdui/mdui.css";
import { PublicBot, PublicChannelInvite } from "stoat.js";

import FlowCheck from "@revolt/auth/src/flows/FlowCheck";
import FlowConfirmReset from "@revolt/auth/src/flows/FlowConfirmReset";
import FlowCreate from "@revolt/auth/src/flows/FlowCreate";
import FlowDeleteAccount from "@revolt/auth/src/flows/FlowDelete";
import FlowHome from "@revolt/auth/src/flows/FlowHome";
import FlowLogin from "@revolt/auth/src/flows/FlowLogin";
import FlowResend from "@revolt/auth/src/flows/FlowResend";
import FlowReset from "@revolt/auth/src/flows/FlowReset";
import FlowVerify from "@revolt/auth/src/flows/FlowVerify";
import { ClientContext, useClient } from "@revolt/client";
import { I18nProvider } from "@revolt/i18n";
import { KeybindContext } from "@revolt/keybinds";
import { ModalContext, ModalRenderer, useModals } from "@revolt/modal";
import { VoiceContext } from "@revolt/rtc";
import { StateContext, SyncWorker, useState } from "@revolt/state";
import { FloatingManager, LoadTheme } from "@revolt/ui";

/* @refresh reload */
import "@revolt/ui/styles";

import AuthPage from "./Auth";
import { initDesktopUpdater } from "./desktopUpdater";
import Interface from "./Interface";
import "./index.css";
import { ClientDebugView } from "./interface/ClientDebugView";
import { DevelopmentPage } from "./interface/Development";
import { Discover } from "./interface/Discover";
import { Friends } from "./interface/Friends";
import { HomePage } from "./interface/Home";
import { ModerationView } from "./interface/ModerationView";
import { ServerHome } from "./interface/ServerHome";
import { ChannelPage } from "./interface/channels/ChannelPage";
import { ModerationEntityView } from "./interface/moderation/ModerationEntityView";
import { captureClientError, isSentryEnabled } from "./sentry";
import "./serviceWorkerInterface";

attachDevtoolsOverlay();

function renderFatalErrorModal(message: string, details: string) {
  let overlay = document.getElementById("fatal-error-modal-overlay");
  let body = document.getElementById("fatal-error-modal-body");

  if (!overlay || !body) {
    overlay = document.createElement("div");
    overlay.id = "fatal-error-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "grid";
    overlay.style.placeItems = "center";
    overlay.style.padding = "20px";
    overlay.style.background = "rgba(17, 24, 39, 0.78)";

    const modal = document.createElement("div");
    modal.style.width = "min(560px, 100%)";
    modal.style.background = "#111827";
    modal.style.border = "1px solid #374151";
    modal.style.borderRadius = "12px";
    modal.style.padding = "18px";
    modal.style.color = "#f9fafb";
    modal.style.fontFamily =
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

    const title = document.createElement("h2");
    title.textContent = "The app hit an unexpected error";
    title.style.margin = "0 0 10px";
    title.style.fontSize = "18px";

    const description = document.createElement("p");
    description.textContent =
      "Error details were captured and sent to Sentry when enabled.";
    description.style.margin = "0 0 14px";
    description.style.opacity = "0.92";

    body = document.createElement("p");
    body.id = "fatal-error-modal-body";
    body.style.margin = "0 0 16px";
    body.style.fontFamily = "monospace";
    body.style.fontSize = "12px";
    body.style.wordBreak = "break-word";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.flexWrap = "wrap";

    const continueButton = document.createElement("button");
    continueButton.type = "button";
    continueButton.textContent = "Continue";
    continueButton.style.padding = "10px 14px";
    continueButton.style.border = "1px solid #4b5563";
    continueButton.style.borderRadius = "8px";
    continueButton.style.background = "#2563eb";
    continueButton.style.color = "#ffffff";
    continueButton.style.cursor = "pointer";
    continueButton.addEventListener("click", () => {
      overlay?.remove();
    });

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh";
    refreshButton.style.padding = "10px 14px";
    refreshButton.style.border = "1px solid #4b5563";
    refreshButton.style.borderRadius = "8px";
    refreshButton.style.background = "transparent";
    refreshButton.style.color = "#f9fafb";
    refreshButton.style.cursor = "pointer";
    refreshButton.addEventListener("click", () => {
      window.location.reload();
    });

    actions.append(continueButton, refreshButton);
    modal.append(title, description, body, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  body.textContent = details ? `${message} | ${details}` : message;
}

function isBenignResizeObserverIssue(value: unknown): boolean {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : "";

  return (
    text.includes("ResizeObserver loop completed with undelivered notifications") ||
    text.includes("ResizeObserver loop limit exceeded")
  );
}

function isTransientNonFatalRejection(value: unknown): boolean {
  if (value && typeof value === "object") {
    const retryAfter = (value as { retry_after?: unknown }).retry_after;
    if (typeof retryAfter === "number") {
      return true;
    }
  }

  if (typeof value === "string") {
    const text = value.toLowerCase();
    if (
      text.includes("<!doctype html") ||
      text.includes("<html") ||
      text.includes("retry_after")
    ) {
      return true;
    }
  }

  if (value instanceof Error) {
    const text = `${value.name} ${value.message}`.toLowerCase();
    if (
      text.includes("networkerror") ||
      text.includes("failed to fetch") ||
      text.includes("loading dynamically imported module")
    ) {
      return true;
    }
  }

  return false;
}

function installGlobalErrorHandling() {
  window.addEventListener("error", (event) => {
    if (
      isBenignResizeObserverIssue(event.message) ||
      isBenignResizeObserverIssue(event.error)
    ) {
      return;
    }

    const result = captureClientError(event.error ?? event.message, "window.error", {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });

    renderFatalErrorModal(
      "A runtime error occurred. The app entered safe mode.",
      result.eventId
        ? `${result.summary} (event ${result.eventId})`
        : result.summary,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (
      isBenignResizeObserverIssue(event.reason) ||
      isTransientNonFatalRejection(event.reason)
    ) {
      event.preventDefault();
      return;
    }

    const result = captureClientError(event.reason, "window.unhandledrejection");

    renderFatalErrorModal(
      "An async runtime error occurred. The app entered safe mode.",
      result.eventId
        ? `${result.summary} (event ${result.eventId})`
        : result.summary,
    );
    event.preventDefault();
  });
}

/**
 * Redirect PWA start to the last active path
 */
function PWARedirect() {
  const state = useState();
  return <Navigate href={state.layout.getLastActivePath()} />;
}

/**
 * Open settings and redirect to last active path
 */
function SettingsRedirect() {
  const { openModal } = useModals();

  onMount(() => openModal({ type: "settings", config: "user" }));
  return <PWARedirect />;
}

/**
 * Open invite and redirect to last active path
 */
function InviteRedirect() {
  const params = useParams();
  const client = useClient();
  const { openModal, showError } = useModals();

  onMount(() => {
    if (params.code) {
      client()
        // TODO: add a helper to stoat.js for this
        .api.get(`/invites/${params.code as ""}`)
        .then((invite) => PublicChannelInvite.from(client(), invite))
        .then((invite) => openModal({ type: "invite", invite }))
        .catch(showError);
    }
  });

  return <PWARedirect />;
}

/**
 * Open bot invite and redirect to last active path
 */
function BotRedirect() {
  const params = useParams();
  const client = useClient();
  const { openModal, showError } = useModals();

  onMount(() => {
    if (params.code) {
      client()
        // TODO: add a helper to stoat.js for this
        .api.get(`/bots/${params.code as ""}/invite`)
        .then((invite) => new PublicBot(client(), invite))
        .then((invite) => openModal({ type: "add_bot", invite }))
        .catch(showError);
    }
  });

  return <PWARedirect />;
}

function MountContext(props: { children?: JSX.Element }) {
  const state = useState();

  /**
   * Tanstack Query client
   */
  const client = new QueryClient();

  return (
    <KeybindContext>
      <ModalContext>
        <ClientContext state={state}>
          <I18nProvider>
            <VoiceContext>
              <QueryClientProvider client={client}>
                {props.children}
                <ModalRenderer />
                <FloatingManager />
              </QueryClientProvider>
            </VoiceContext>
          </I18nProvider>
          <SyncWorker />
        </ClientContext>
      </ModalContext>
    </KeybindContext>
  );
}

function FatalAppFallback(props: { error: unknown; reset: () => void }) {
  const result = captureClientError(props.error, "solid.error-boundary");

  return (
    <div
      style={{
        display: "grid",
        "place-items": "center",
        "min-height": "100vh",
        padding: "24px",
        "background-color": "#111827",
        color: "#f9fafb",
      }}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          padding: "20px",
          border: "1px solid #374151",
          "border-radius": "12px",
          "background-color": "#1f2937",
        }}
      >
        <h1 style={{ margin: "0 0 12px", "font-size": "20px" }}>
          The desktop client hit an unexpected error.
        </h1>
        <p style={{ margin: "0 0 16px", opacity: 0.92 }}>
          Error details were captured. You can try recovering without restarting.
        </p>
        <p
          style={{
            margin: "0 0 8px",
            opacity: 0.95,
            "font-family": "monospace",
            "font-size": "12px",
            "word-break": "break-word",
          }}
        >
          {result.summary}
        </p>
        <Show when={isSentryEnabled() && result.eventId}>
          <p
            style={{
              margin: "0 0 16px",
              opacity: 0.85,
              "font-family": "monospace",
              "font-size": "12px",
              "word-break": "break-word",
            }}
          >
            Sentry event: {result.eventId}
          </p>
        </Show>
        <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap" }}>
          <button
            type="button"
            onClick={props.reset}
            style={{
              padding: "10px 14px",
              border: "1px solid #4b5563",
              "border-radius": "8px",
              "background-color": "#2563eb",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Try Recover
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 14px",
              border: "1px solid #4b5563",
              "border-radius": "8px",
              "background-color": "transparent",
              color: "#f9fafb",
              cursor: "pointer",
            }}
          >
            Reload App
          </button>
        </div>
      </div>
    </div>
  );
}

installGlobalErrorHandling();
initDesktopUpdater();

render(
  () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <FatalAppFallback error={error} reset={reset} />
      )}
    >
      <StateContext>
        <Router root={MountContext}>
          <Route path="/login" component={AuthPage as never}>
            <Route path="/delete/:token" component={FlowDeleteAccount} />
            <Route path="/check" component={FlowCheck} />
            <Route path="/create" component={FlowCreate} />
            <Route path="/create/:code" component={FlowCreate} />
            <Route path="/auth" component={FlowLogin} />
            <Route path="/resend" component={FlowResend} />
            <Route path="/reset" component={FlowReset} />
            <Route path="/verify/:token" component={FlowVerify} />
            <Route path="/reset/:token" component={FlowConfirmReset} />
            <Route path="/*" component={FlowHome} />
          </Route>
          <Route path="/" component={Interface as never}>
            <Route path="/pwa" component={PWARedirect} />
            <Route path="/dev" component={DevelopmentPage} />
            <Route path="/debug/client" component={ClientDebugView} />
            <Route path="/discover/*" component={Discover} />
            <Route path="/settings" component={SettingsRedirect} />
            <Route path="/invite/:code" component={InviteRedirect} />
            <Route path="/bot/:code" component={BotRedirect} />
            <Route
              path="/moderation/view/:entityType/:entityId"
              component={ModerationEntityView}
            />
            <Route
              path="/moderation/:targetType/:targetId"
              component={ModerationView}
            />
            <Route path="/moderation/*" component={ModerationView} />
            <Route path="/friends" component={Friends} />
            <Route path="/server/:server/*">
              <Route path="/channel/:channel/*" component={ChannelPage} />
              <Route path="/*" component={ServerHome} />
            </Route>
            <Route path="/channel/:channel/*" component={ChannelPage} />
            <Route path="/*" component={HomePage} />
          </Route>
        </Router>

        <LoadTheme />
        {/* <ReportBug /> */}
      </StateContext>
    </ErrorBoundary>
  ),
  document.getElementById("root") as HTMLElement,
);
