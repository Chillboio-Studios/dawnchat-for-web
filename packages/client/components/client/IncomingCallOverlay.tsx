import {
  Show,
  createEffect,
  createMemo,
  createSignal,
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
import { Button } from "@revolt/ui/components/design";

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function createRingtoneController() {
  let context: AudioContext | undefined;
  let oscillator: OscillatorNode | undefined;
  let gainNode: GainNode | undefined;
  let stopTimer: ReturnType<typeof setInterval> | undefined;

  function stop() {
    if (stopTimer) {
      clearInterval(stopTimer);
      stopTimer = undefined;
    }

    try {
      oscillator?.stop();
    } catch {
      // no-op
    }

    oscillator?.disconnect();
    gainNode?.disconnect();

    oscillator = undefined;
    gainNode = undefined;
  }

  async function start() {
    if (typeof window === "undefined") return;
    if (oscillator) return;

    const appWindow = window as WindowWithWebkitAudioContext;
    const AudioContextImpl =
      appWindow.AudioContext || appWindow.webkitAudioContext;
    if (!AudioContextImpl) return;

    if (!context) {
      context = new AudioContextImpl();
    }

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return;
      }
    }

    oscillator = context.createOscillator();
    gainNode = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 720;
    gainNode.gain.value = 0.0001;

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();

    const currentContext = context;
    let ringOn = true;
    stopTimer = setInterval(() => {
      if (!gainNode || !currentContext) return;
      gainNode.gain.setValueAtTime(
        ringOn ? 0.06 : 0.0001,
        currentContext.currentTime,
      );
      ringOn = !ringOn;
    }, 500);
  }

  return {
    start,
    stop,
  };
}

export function IncomingCallOverlay() {
  const client = useClient();
  const voice = useVoice();
  const navigate = useNavigate();
  const [dismissedCallIds, setDismissedCallIds] = createSignal<string[]>([]);
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
      .filter((item) => !dismissedCallIds().includes(item.callId))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  });

  createEffect(() => {
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

    try {
      await voice.connect(channel);
      await pushRemoteCallState(call.channelId, call.callId, "Active", {
        startedById: call.startedById,
        updatedById: client().user?.id,
      });
      navigate(channel.url || channel.path);
    } catch (error) {
      console.error("[call] failed to accept incoming call", error);
    }
  }

  async function dismissCall() {
    const call = activeIncomingCall();
    if (!call) return;

    setDismissedCallIds((current) => [...current, call.callId]);

    await pushRemoteCallState(call.channelId, call.callId, "Missed", {
      startedById: call.startedById,
      updatedById: client().user?.id,
    });
  }

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
