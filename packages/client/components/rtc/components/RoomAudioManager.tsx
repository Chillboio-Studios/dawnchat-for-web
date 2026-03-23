import { createMemo } from "solid-js";
import { AudioTrack, useTracks } from "solid-livekit-components";

import { getTrackReferenceId, isLocal } from "@livekit/components-core";
import { Key } from "@solid-primitives/keyed";
import { Track } from "livekit-client";

import { useState } from "@revolt/state";

import { useVoice } from "../state";

export function RoomAudioManager() {
  const voice = useVoice();
  const state = useState();

  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: true,
    },
  );

  const filteredTracks = createMemo(() =>
    tracks().filter(
      (track) =>
        !isLocal(track.participant) &&
        track.publication.kind === Track.Kind.Audio,
    ),
  );

  return (
    <div style={{ display: "none" }}>
      <Key each={filteredTracks()} by={(item) => getTrackReferenceId(item)}>
        {(track) => (
          <AudioTrack
            trackRef={track()}
            volume={
              state.voice.outputVolume *
              state.voice.getUserVolume(track().participant.identity)
            }
            muted={
              state.voice.getUserMuted(track().participant.identity) ||
              (track().source === Track.Source.ScreenShareAudio &&
                state.voice.getUserScreenShareAudioMuted(
                  track().participant.identity,
                )) ||
              voice.deafen()
            }
          />
        )}
      </Key>
    </div>
  );
}
