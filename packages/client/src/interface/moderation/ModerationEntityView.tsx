import { createEffect } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";
import { useNavigate, useParams } from "@revolt/routing";
import { Text } from "@revolt/ui";

/**
 * Backwards-compatible route bridge for old moderation deep links.
 * Redirects legacy entity view URLs into the new moderation workspace route.
 */
export function ModerationEntityView() {
  const navigate = useNavigate();
  const params = useParams<{ entityType?: string; entityId?: string }>();

  createEffect(() => {
    const entityType = (params.entityType || "").trim();
    const entityId = (params.entityId || "").trim();

    if (
      entityType !== "user" &&
      entityType !== "message" &&
      entityType !== "server" &&
      entityType !== "image"
    ) {
      navigate("/moderation");
      return;
    }

    if (!entityId) {
      navigate("/moderation");
      return;
    }

    navigate(`/moderation/${entityType}/${entityId}`);
  });

  return (
    <Text>
      <Trans>Opening moderation target...</Trans>
    </Text>
  );
}
