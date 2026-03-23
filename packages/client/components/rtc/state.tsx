import {
  Accessor,
  JSX,
  Setter,
  batch,
  createContext,
  createSignal,
  useContext,
} from "solid-js";
import { RoomContext } from "solid-livekit-components";

import { Room } from "livekit-client";
import { DenoiseTrackProcessor } from "livekit-rnnoise-processor";
import { Channel } from "stoat.js";

import { useState } from "@revolt/state";
import { Voice as VoiceSettings } from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { CONFIGURATION } from "@revolt/common";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";

type State =
  | "READY"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

const CONNECT_TIMEOUT_MS = 15000;

class Voice {
  #settings: VoiceSettings;

  channel: Accessor<Channel | undefined>;
  #setChannel: Setter<Channel | undefined>;

  room: Accessor<Room | undefined>;
  #setRoom: Setter<Room | undefined>;

  state: Accessor<State>;
  #setState: Setter<State>;

  deafen: Accessor<boolean>;
  #setDeafen: Setter<boolean>;

  microphone: Accessor<boolean>;
  #setMicrophone: Setter<boolean>;

  video: Accessor<boolean>;
  #setVideo: Setter<boolean>;

  screenshare: Accessor<boolean>;
  #setScreenshare: Setter<boolean>;

  constructor(voiceSettings: VoiceSettings) {
    this.#settings = voiceSettings;

    const [channel, setChannel] = createSignal<Channel>();
    this.channel = channel;
    this.#setChannel = setChannel;

    const [room, setRoom] = createSignal<Room>();
    this.room = room;
    this.#setRoom = setRoom;

    const [state, setState] = createSignal<State>("READY");
    this.state = state;
    this.#setState = setState;

    const [deafen, setDeafen] = createSignal<boolean>(false);
    this.deafen = deafen;
    this.#setDeafen = setDeafen;

    const [microphone, setMicrophone] = createSignal(false);
    this.microphone = microphone;
    this.#setMicrophone = setMicrophone;

    const [video, setVideo] = createSignal(false);
    this.video = video;
    this.#setVideo = setVideo;

    const [screenshare, setScreenshare] = createSignal(false);
    this.screenshare = screenshare;
    this.#setScreenshare = setScreenshare;
  }

  async connect(channel: Channel, auth?: { url: string; token: string }) {
    this.disconnect();

    const room = new Room({
      adaptiveStream: this.#settings.videoAdaptiveStream,
      dynacast: this.#settings.videoDynacast,
      audioCaptureDefaults: {
        deviceId: this.#settings.preferredAudioInputDevice,
        echoCancellation: this.#settings.echoCancellation,
        noiseSuppression: this.#settings.noiseSupression === "browser",
        autoGainControl: this.#settings.autoGainControl,
      },
      audioOutput: {
        deviceId: this.#settings.preferredAudioOutputDevice,
      },
    });

    batch(() => {
      this.#setRoom(room);
      this.#setChannel(channel);
      this.#setState("CONNECTING");

      this.#setMicrophone(false);
      this.#setDeafen(false);
      this.#setVideo(false);
      this.#setScreenshare(false);
    });

    room.addListener("connected", () => {
      this.#setState("CONNECTED");
      if (this.speakingPermission)
        room.localParticipant.setMicrophoneEnabled(true).then((track) => {
          this.#setMicrophone(typeof track !== "undefined");
          if (this.#settings.noiseSupression === "enhanced") {
            track?.audioTrack?.setProcessor(
              new DenoiseTrackProcessor({
                workletCDNURL: CONFIGURATION.RNNOISE_WORKLET_CDN_URL,
              }),
            );
          }
        });
    });

    room.addListener("reconnecting", () => this.#setState("RECONNECTING"));
    room.addListener("reconnected", () => this.#setState("CONNECTED"));

    room.addListener("localTrackPublished", () => {
      this.#setVideo(room.localParticipant.isCameraEnabled);
      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
    });

    room.addListener("localTrackUnpublished", () => {
      this.#setVideo(room.localParticipant.isCameraEnabled);
      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
    });

    room.addListener("disconnected", () => this.#setState("DISCONNECTED"));

    try {
      if (!auth) {
        auth = await channel.joinCall("worldwide");
      }

      await Promise.race([
        room.connect(auth.url, auth.token, {
          autoSubscribe: true,
        }),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error("Voice connection timed out"));
          }, CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      console.error("[rtc] failed to connect", error);
      this.disconnect();
      throw error;
    }
  }

  disconnect() {
    const room = this.room();
    if (!room) return;

    room.removeAllListeners();
    room.disconnect();

    batch(() => {
      this.#setState("READY");
      this.#setRoom(undefined);
      this.#setChannel(undefined);
      this.#setMicrophone(false);
      this.#setVideo(false);
      this.#setScreenshare(false);
    });
  }

  async toggleDeafen() {
    this.#setDeafen((s) => !s);
  }

  async toggleMute() {
    const room = this.room();
    if (!room) throw "invalid state";
    await room.localParticipant.setMicrophoneEnabled(
      !room.localParticipant.isMicrophoneEnabled,
    );

    this.#setMicrophone(room.localParticipant.isMicrophoneEnabled);
  }

  async toggleCamera() {
    const room = this.room();
    if (!room) throw "invalid state";
    if (!this.canUseCamera) throw "camera unsupported";
    if (!this.videoPermission) throw "missing video permission";

    try {
      await room.localParticipant.setCameraEnabled(
        !room.localParticipant.isCameraEnabled,
      );
      this.#setVideo(room.localParticipant.isCameraEnabled);
    } catch (error) {
      console.error("[rtc] failed to toggle camera", error);
      this.#setVideo(room.localParticipant.isCameraEnabled);
      throw error;
    }
  }

  async toggleScreenshare() {
    const room = this.room();
    if (!room) throw "invalid state";
    if (!this.canScreenShare) throw "screen share unsupported";
    if (!this.videoPermission) throw "missing video permission";

    const shouldEnable = !room.localParticipant.isScreenShareEnabled;

    // Some mobile browsers expose getDisplayMedia on navigator, but not on mediaDevices.
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia !== "function" &&
      typeof (navigator as Navigator & { getDisplayMedia?: unknown })
        .getDisplayMedia === "function"
    ) {
      (
        navigator.mediaDevices as MediaDevices & {
          getDisplayMedia?: MediaDevices["getDisplayMedia"];
        }
      ).getDisplayMedia = (
        navigator as Navigator & {
          getDisplayMedia: MediaDevices["getDisplayMedia"];
        }
      ).getDisplayMedia;
    }

    if (
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getDisplayMedia !== "function" &&
      typeof (
        window as Window & {
          getDisplayMedia?: unknown;
        }
      ).getDisplayMedia === "function"
    ) {
      (
        navigator.mediaDevices as MediaDevices & {
          getDisplayMedia?: MediaDevices["getDisplayMedia"];
        }
      ).getDisplayMedia = (
        window as Window & {
          getDisplayMedia: MediaDevices["getDisplayMedia"];
        }
      ).getDisplayMedia;
    }

    const userAgent =
      typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
    const isMobile = /android|iphone|ipad|ipod/.test(userAgent);

    const captureOptions: {
      audio: boolean;
      video: boolean;
      preferCurrentTab?: boolean;
      selfBrowserSurface?: string;
      systemAudio?: string;
    } = {
      audio: this.#settings.screenShareWithAudio,
      video: true,
    };

    if (isMobile) {
      captureOptions.preferCurrentTab = true;
      captureOptions.selfBrowserSurface = "include";
      captureOptions.systemAudio = this.#settings.screenShareWithAudio
        ? "include"
        : "exclude";
    }

    try {
      if (!shouldEnable) {
        await room.localParticipant.setScreenShareEnabled(false);
      } else {
        try {
          await room.localParticipant.setScreenShareEnabled(
            true,
            captureOptions,
          );
        } catch (error) {
          if (!this.#settings.screenShareWithAudio) {
            throw error;
          }

          // Retry without audio when browsers reject combined capture.
          await room.localParticipant.setScreenShareEnabled(true, {
            ...captureOptions,
            audio: false,
          });
        }
      }

      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
    } catch (error) {
      console.error("[rtc] failed to toggle screenshare", error);
      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
      throw error;
    }
  }

  async toggleScreenshareAudioForEveryone() {
    const room = this.room();
    if (!room) throw "invalid state";

    const publication = room.localParticipant
      .getTrackPublication(Track.Source.ScreenShareAudio)
      ?.track;

    if (!publication || publication.kind !== Track.Kind.Audio) {
      return;
    }

    if (publication.isMuted) {
      await publication.unmute();
    } else {
      await publication.mute();
    }
  }

  get isScreenshareAudioMutedForEveryone() {
    const track = this.room()
      ?.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
      ?.track;

    if (!track || track.kind !== Track.Kind.Audio) {
      return false;
    }

    return track.isMuted;
  }

  getConnectedUser(userId: string) {
    return this.room()?.getParticipantByIdentity(userId);
  }

  get listenPermission() {
    return !!this.channel()?.havePermission("Listen");
  }

  get speakingPermission() {
    return !!this.channel()?.havePermission("Speak");
  }

  get videoPermission() {
    return !!this.channel()?.havePermission("Video");
  }

  get canUseCamera() {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function"
    );
  }

  get canScreenShare() {
    if (typeof navigator === "undefined") return false;

    const mediaDevicesAny = navigator.mediaDevices as
      | (MediaDevices & {
          getDisplayMedia?: unknown;
        })
      | undefined;

    const legacyNavigator = navigator as Navigator & {
      getDisplayMedia?: unknown;
    };

    const legacyWindow =
      typeof window !== "undefined"
        ? (window as Window & {
            getDisplayMedia?: unknown;
          })
        : undefined;

    // On some mobile browsers the function is exposed lazily or non-typed.
    const hasDisplayCaptureSignal =
      typeof mediaDevicesAny?.getDisplayMedia === "function" ||
      "getDisplayMedia" in (mediaDevicesAny ?? {}) ||
      typeof legacyNavigator.getDisplayMedia === "function" ||
      typeof legacyWindow?.getDisplayMedia === "function";

    if (hasDisplayCaptureSignal) return true;

    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /android|iphone|ipad|ipod/.test(ua);

    // Be optimistic on modern mobile secure contexts; runtime call will still
    // fail safely if the browser blocks capture.
    return Boolean(
      isMobile &&
        typeof window !== "undefined" &&
        window.isSecureContext &&
        typeof navigator.mediaDevices?.getUserMedia === "function",
    );
  }
}

const voiceContext = createContext<Voice>(null as unknown as Voice);

/**
 * Mount global voice context and room audio manager
 */
export function VoiceContext(props: { children: JSX.Element }) {
  const state = useState();
  const voice = new Voice(state.voice);

  return (
    <voiceContext.Provider value={voice}>
      <RoomContext.Provider value={voice.room}>
        <VoiceCallCardContext>{props.children}</VoiceCallCardContext>
        <InRoom>
          <RoomAudioManager />
        </InRoom>
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
