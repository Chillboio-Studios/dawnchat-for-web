import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

import { styled } from "styled-system/jsx";

import { useClient } from "@revolt/client";
import {
  ensureClientApiSocketConnected,
  getAllRemoteCallStates,
  pushRemoteCallState,
} from "@revolt/common/lib/clientApiSocket";
import { useNavigate } from "@revolt/routing";
import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { Button } from "@revolt/ui/components/design";
import callRingtoneMp3 from "../../assets/ringer/Call Sound.mp3";

const RING_TIMEOUT_MS = 60_000;

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function toRoutablePath(candidate?: string): string | undefined {
  if (!candidate) return undefined;

  // Accept already-routable app paths.
  if (candidate.startsWith("/")) {
    return candidate;
  }

  // Convert absolute links to app-relative paths.
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function createRingtoneController() {
  let audio: HTMLAudioElement | undefined;

  function stop() {
    if (!audio) {
      return;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // no-op
    }
  }

  async function start() {
    if (typeof window === "undefined") return;

    if (!audio) {
      audio = new Audio(callRingtoneMp3);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0.9;
    }

    try {
      await audio.play();
    } catch {
      // Ignore autoplay/media permission issues.
    }
  }

  return {
    start,
    stop,
  };
}

export function IncomingCallOverlay() {
  const client = useClient();
  const voice = useVoice();
  const state = useState();
  const navigate = useNavigate();
  const [dismissedCallIds, setDismissedCallIds] = createSignal<
    Record<string, number>
  >({});
  const ringtone = createRingtoneController();

  createEffect(() => {
    ensureClientApiSocketConnected();
  });

  const activeIncomingCall = createMemo(() => {
    const currentUserId = client().user?.id;
    if (!currentUserId) return undefined;

    const activeChannelId = voice.channel()?.id;

    return getAllRemoteCallStates()
      .filter((item) => item.status === "Ringing")
      .filter((item) => item.startedById !== currentUserId)
      .filter((item) => item.channelId !== activeChannelId)
      .filter((item) => {
        const channel = client().channels.get(item.channelId);
        return channel?.type === "DirectMessage" || channel?.type === "Group";
      })
      .filter((item) => {
        const dismissedAt = dismissedCallIds()[item.callId] ?? 0;
        // Allow re-ringing if this call state has been updated after dismissal.
        return item.updatedAt > dismissedAt;
      })
      .filter((item) => Date.now() - item.updatedAt < RING_TIMEOUT_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  });

  createEffect(
    on(
      () => activeIncomingCall()?.callId,
      (nextCallId, previousCallId) => {
        if (!nextCallId || !previousCallId || nextCallId === previousCallId) {
          return;
        }

        // Keep dismissed map bounded as calls change over time.
        setDismissedCallIds((current) => {
          const entries = Object.entries(current);
          if (entries.length <= 128) {
            return current;
          }

          return Object.fromEntries(entries.slice(-96));
        });
      },
    ),
  );

  createEffect(() => {
    if (state.settings.getValue("notifications:ringing_enabled") === false) {
      ringtone.stop();
      return;
    }

    if (activeIncomingCall()) {
      void ringtone.start();
      return;
    }

    ringtone.stop();
  });

  async function acceptCall() {
    const call = activeIncomingCall();
    if (!call) return;

    const channel = client().channels.get(call.channelId);
    if (!channel) return;
    if (channel.type !== "DirectMessage" && channel.type !== "Group") return;

    try {
      await voice.connect(channel);
      await pushRemoteCallState(call.channelId, call.callId, "Active", {
        startedById: call.startedById,
        updatedById: client().user?.id,
        channelType: channel.type,
      });

      const fallbackPath = `/channel/${channel.id}`;
      const nextPath =
        toRoutablePath(channel.url) ||
        toRoutablePath(channel.path) ||
        fallbackPath;
      navigate(nextPath);
    } catch (error) {
      console.error("[call] failed to accept incoming call", error);
    }
  }

  async function dismissCall() {
    const call = activeIncomingCall();
    if (!call) return;

    setDismissedCallIds((current) => ({
      ...current,
      [call.callId]: Date.now(),
    }));

    await pushRemoteCallState(call.channelId, call.callId, "Missed", {
      startedById: call.startedById,
      updatedById: client().user?.id,
    });
  }

  async function stopRinging() {
    const call = activeIncomingCall();
    if (!call) return;

    const channel = client().channels.get(call.channelId);
    const channelType =
      channel?.type === "DirectMessage" || channel?.type === "Group"
        ? channel.type
        : undefined;

    setDismissedCallIds((current) => ({
      ...current,
      [call.callId]: Date.now(),
    }));

    await pushRemoteCallState(call.channelId, call.callId, "Ended", {
      startedById: call.startedById,
      updatedById: client().user?.id,
      channelType,
    });
  }

  function disableRinging() {
    state.settings.setValue("notifications:ringing_enabled", false);
    ringtone.stop();
  }

  createEffect(() => {
    const call = activeIncomingCall();
    if (!call) {
      return;
    }

    const elapsed = Date.now() - call.updatedAt;
    const remaining = RING_TIMEOUT_MS - elapsed;

    if (remaining <= 0) {
      void stopRinging();
      return;
    }

    const timer = window.setTimeout(() => {
      void stopRinging();
    }, remaining);

    onCleanup(() => {
      window.clearTimeout(timer);
    });
  });

  onCleanup(() => {
    ringtone.stop();
  });

  return (
    <Show when={activeIncomingCall()}>
      {(call) => {
        const channel = () => client().channels.get(call().channelId);

        return (
          <OverlayRoot>
            <OverlayCard>
              <OverlayTitle>Incoming Call</OverlayTitle>
              <OverlayBody>{channel()?.name || "Unknown Channel"}</OverlayBody>
              <OverlayActions>
                <Button variant="tonal" onPress={disableRinging}>
                  Disable Ringing
                </Button>
                <Button variant="tonal" onPress={stopRinging}>
                  Stop Ringing
                </Button>
                <Button variant="_error" onPress={dismissCall}>
                  Decline
                </Button>
                <Button variant="filled" onPress={acceptCall}>
                  Accept
                </Button>
              </OverlayActions>
            </OverlayCard>
          </OverlayRoot>
        );
      }}
    </Show>
  );
}

const OverlayRoot = styled("div", {
  base: {
    position: "fixed",
    inset: "0",
    zIndex: 200,
    pointerEvents: "none",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "20px",
  },
});

const OverlayCard = styled("div", {
  base: {
    pointerEvents: "all",
    width: "min(420px, 92vw)",
    borderRadius: "16px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-high)",
    boxShadow: "0 24px 48px rgba(0, 0, 0, 0.35)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
});

const OverlayTitle = styled("div", {
  base: {
    fontSize: "14px",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--md-sys-color-on-surface-variant)",
    fontWeight: 700,
  },
});

const OverlayBody = styled("div", {
  base: {
    fontSize: "18px",
    fontWeight: 700,
    color: "var(--md-sys-color-on-surface)",
  },
});

const OverlayActions = styled("div", {
  base: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "6px",
  },
});
