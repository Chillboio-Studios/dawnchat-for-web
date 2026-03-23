import { Column } from "@revolt/ui";

import { VoiceInputOptions } from "./VoiceInputOptions";
import { VoiceProcessingOptions } from "./VoiceProcessingOptions";
import { VideoOptions } from "./VideoOptions";

/**
 * Configure voice options
 */
export function VoiceSettings() {
  return (
    <Column gap="lg">
      <VoiceInputOptions />
      <VoiceProcessingOptions />
      <VideoOptions />
    </Column>
  );
}
