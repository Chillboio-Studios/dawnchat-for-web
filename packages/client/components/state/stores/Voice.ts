import { State } from "..";

import { AbstractStore } from ".";

/**
 * Possible noise suppresion states. Browser is browser noise suppresion and enhanced is machine learning suppression via RNNoise.
 */
export type NoiseSuppresionState = "disabled" | "browser" | "enhanced";

const NoiseSuppresionStates: NoiseSuppresionState[] = [
  "disabled",
  "browser",
  "enhanced",
];

export interface TypeVoice {
  preferredAudioInputDevice?: string;
  preferredAudioOutputDevice?: string;
  screenShareWithAudio: boolean;
  videoAdaptiveStream: boolean;
  videoDynacast: boolean;

  echoCancellation: boolean;
  noiseSupression: NoiseSuppresionState;
  autoGainControl: boolean;

  inputVolume: number;
  outputVolume: number;

  userVolumes: Record<string, number>;
  userMutes: Record<string, boolean>;
  userScreenShareAudioMutes: Record<string, boolean>;
}

/**
 * Handles enabling and disabling client experiments.
 */
export class Voice extends AbstractStore<"voice", TypeVoice> {
  /**
   * Construct store
   * @param state State
   */
  constructor(state: State) {
    super(state, "voice");
  }

  /**
   * Hydrate external context
   */
  hydrate(): void {
    /** nothing needs to be done */
  }

  /**
   * Generate default values
   */
  default(): TypeVoice {
    return {
      screenShareWithAudio: false,
      videoAdaptiveStream: true,
      videoDynacast: true,
      echoCancellation: true,
      noiseSupression: "browser",
      autoGainControl: true,
      inputVolume: 1.0,
      outputVolume: 1.0,
      userVolumes: {},
      userMutes: {},
      userScreenShareAudioMutes: {},
    };
  }

  /**
   * Validate the given data to see if it is compliant and return a compliant object
   */
  clean(input: Partial<TypeVoice>): TypeVoice {
    const data = this.default();

    if (typeof input.preferredAudioInputDevice === "string") {
      data.preferredAudioInputDevice = input.preferredAudioInputDevice;
    }

    if (typeof input.preferredAudioOutputDevice === "string") {
      data.preferredAudioOutputDevice = input.preferredAudioOutputDevice;
    }

    if (typeof input.screenShareWithAudio === "boolean") {
      data.screenShareWithAudio = input.screenShareWithAudio;
    }

    if (typeof input.videoAdaptiveStream === "boolean") {
      data.videoAdaptiveStream = input.videoAdaptiveStream;
    }

    if (typeof input.videoDynacast === "boolean") {
      data.videoDynacast = input.videoDynacast;
    }

    if (typeof input.echoCancellation === "boolean") {
      data.echoCancellation = input.echoCancellation;
    }

    // migrate legacy noise suppression to new suppression state
    if ((input.noiseSupression as unknown) === "true") {
      data.noiseSupression = "browser";
    } else if ((input.noiseSupression as unknown) === "false") {
      data.noiseSupression = "disabled";
    } else if (
      input.noiseSupression &&
      NoiseSuppresionStates.includes(input.noiseSupression)
    ) {
      data.noiseSupression = input.noiseSupression;
    }

    if (typeof input.autoGainControl === "boolean") {
      data.autoGainControl = input.autoGainControl;
    }

    if (typeof input.inputVolume === "number") {
      data.inputVolume = input.inputVolume;
    }

    if (typeof input.outputVolume === "number") {
      data.outputVolume = input.outputVolume;
    }

    if (typeof input.userVolumes === "object") {
      Object.entries(input.userVolumes)
        .filter(
          ([userId, volume]) =>
            typeof userId === "string" && typeof volume === "number",
        )
        .forEach(([k, v]) => (data.userVolumes[k] = v));
    }

    if (typeof input.userMutes === "object") {
      Object.entries(input.userMutes)
        .filter(
          ([userId, muted]) => typeof userId === "string" && muted === true,
        )
        .forEach(([k, v]) => (data.userMutes[k] = v));
    }

    if (typeof input.userScreenShareAudioMutes === "object") {
      Object.entries(input.userScreenShareAudioMutes)
        .filter(
          ([userId, muted]) => typeof userId === "string" && muted === true,
        )
        .forEach(([k, v]) => (data.userScreenShareAudioMutes[k] = v));
    }

    return data;
  }

  /**
   * Set a user's volume
   * @param userId User ID
   * @param volume Volume
   */
  setUserVolume(userId: string, volume: number) {
    this.set("userVolumes", userId, volume);
  }

  /**
   * Get a user's volume
   * @param userId User ID
   * @returns Volume or default
   */
  getUserVolume(userId: string): number {
    return this.get().userVolumes[userId] || 1.0;
  }

  /**
   * Set whether a user is muted
   * @param userId User ID
   * @param muted Whether they should be muted
   */
  setUserMuted(userId: string, muted: boolean) {
    this.set("userMutes", userId, muted);
  }

  /**
   * Set whether a user's shared screen audio is muted locally
   * @param userId User ID
   * @param muted Whether they should be muted locally
   */
  setUserScreenShareAudioMuted(userId: string, muted: boolean) {
    this.set("userScreenShareAudioMutes", userId, muted);
  }

  /**
   * Get whether a user is muted
   * @param userId User ID
   * @returns Whether muted
   */
  getUserMuted(userId: string): boolean {
    return this.get().userMutes[userId] || false;
  }

  /**
   * Get whether a user's shared screen audio is muted locally
   * @param userId User ID
   * @returns Whether muted
   */
  getUserScreenShareAudioMuted(userId: string): boolean {
    return this.get().userScreenShareAudioMutes[userId] || false;
  }

  /**
   * Set the preferred audio input device
   */
  set preferredAudioInputDevice(value: string) {
    this.set("preferredAudioInputDevice", value);
  }

  /**
   * Set the preferred audio output device
   */
  set preferredAudioOutputDevice(value: string) {
    this.set("preferredAudioOutputDevice", value);
  }

  /**
   * Set whether screenshare should include audio when available
   */
  set screenShareWithAudio(value: boolean) {
    this.set("screenShareWithAudio", value);
  }

  /**
   * Prefer adaptive stream for better call stability
   */
  set videoAdaptiveStream(value: boolean) {
    this.set("videoAdaptiveStream", value);
  }

  /**
   * Enable dynacast for better call stability
   */
  set videoDynacast(value: boolean) {
    this.set("videoDynacast", value);
  }

  /**
   * Set echo cancellation
   */
  set echoCancellation(value: boolean) {
    this.set("echoCancellation", value);
  }

  /**
   * Set noise cancellation
   */
  set noiseSupression(value: NoiseSuppresionState) {
    this.set("noiseSupression", value);
  }

  /**
   * Set auto gain control
   */
  set autoGainControl(value: boolean) {
    this.set("autoGainControl", value);
  }

  /**
   * Set input volume
   */
  set inputVolume(value: number) {
    this.set("inputVolume", value);
  }

  /**
   * Set output volume
   */
  set outputVolume(value: number) {
    this.set("outputVolume", value);
  }

  /**
   * Get the preferred audio input device
   */
  get preferredAudioInputDevice(): string | undefined {
    return this.get().preferredAudioInputDevice;
  }

  /**
   * Get the preferred audio output device
   */
  get preferredAudioOutputDevice(): string | undefined {
    return this.get().preferredAudioOutputDevice;
  }

  /**
   * Get whether screenshare should include audio
   */
  get screenShareWithAudio(): boolean {
    return this.get().screenShareWithAudio;
  }

  /**
   * Get adaptive stream preference
   */
  get videoAdaptiveStream(): boolean {
    return this.get().videoAdaptiveStream;
  }

  /**
   * Get dynacast preference
   */
  get videoDynacast(): boolean {
    return this.get().videoDynacast;
  }

  /**
   * Get echo cancellation
   */
  get echoCancellation(): boolean | undefined {
    return this.get().echoCancellation;
  }

  /**
   * Get noise supression
   */
  get noiseSupression(): NoiseSuppresionState | undefined {
    return this.get().noiseSupression;
  }

  /**
   * Get auto gain control
   */
  get autoGainControl(): boolean | undefined {
    return this.get().autoGainControl;
  }

  /**
   * Get input volume
   */
  get inputVolume(): number {
    return this.get().inputVolume;
  }

  /**
   * Get noise supression
   */
  get outputVolume(): number {
    return this.get().outputVolume;
  }
}
