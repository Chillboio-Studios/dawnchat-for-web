import { Trans } from "@lingui-solid/solid/macro";

import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Text } from "@revolt/ui";

/**
 * Video options
 */
export function VideoOptions() {
  const state = useState();

  return (
    <Column>
      <Text class="title">
        <Trans>Video Settings</Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={state.voice.videoAdaptiveStream} />}
          onClick={() =>
            (state.voice.videoAdaptiveStream = !state.voice.videoAdaptiveStream)
          }
          description={
            <Trans>
              Dynamically adjusts received video quality to reduce flicker and
              network instability.
            </Trans>
          }
        >
          <Trans>Adaptive video stream</Trans>
        </CategoryButton>
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={state.voice.videoDynacast} />}
          onClick={() =>
            (state.voice.videoDynacast = !state.voice.videoDynacast)
          }
          description={
            <Trans>
              Stops sending unnecessary high-quality layers to improve call
              stability.
            </Trans>
          }
        >
          <Trans>Dynamic video layers (Dynacast)</Trans>
        </CategoryButton>
      </CategoryButton.Group>
    </Column>
  );
}
