import { createEffect, onCleanup } from "solid-js";

import { applyDmCallRingingUpdate } from "./callRingingState";
import { State as LifecycleState } from "./Controller";
import { useClient, useClientLifecycle } from "./index";

/**
 * Subscribes to native event stream ringing updates.
 */
export function CallRingingWorker() {
  const client = useClient();
  const { lifecycle } = useClientLifecycle();

  createEffect(() => {
    if (lifecycle.state() !== LifecycleState.Connected) return;

    const handler = (payload: {
      channel_id: string;
      initiator_id: string;
      started_at?: string;
      ended: boolean;
      recipients?: string[];
    }) => {
      applyDmCallRingingUpdate(payload);
    };

    client().on("dmCallRingingUpdate", handler);

    onCleanup(() => {
      client().off("dmCallRingingUpdate", handler);
    });
  });

  return null;
}
