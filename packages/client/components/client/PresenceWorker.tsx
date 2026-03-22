import { createEffect, onCleanup } from "solid-js";
import type { API } from "stoat.js";

import { State as LifecycleState } from "./Controller";
import {
  ensureClientApiSocketConnected,
  subscribeClientApiSocket,
} from "../common/lib/clientApiSocket";
import { useClientLifecycle } from "./index";
import { applyPresenceEvent, replacePresenceSnapshot } from "./presenceState";

type PresenceSnapshotMessage = {
  users: {
    userId: string;
    presence?: API.Presence;
    status?: {
      presence?: API.Presence;
      text?: string;
    };
    updatedAt?: number;
  }[];
};

type PresenceUpdateMessage = {
  userId: string;
  presence?: API.Presence;
  status?: {
    presence?: API.Presence;
    text?: string;
  };
  updatedAt?: number;
};

/**
 * Subscribe to the presence stream and merge incoming updates into local UI state.
 */
export function PresenceWorker() {
  const { lifecycle } = useClientLifecycle();
  const unsubscribe = subscribeClientApiSocket((message) => {
    if (message.type === "presence:snapshot") {
      replacePresenceSnapshot((message.data as PresenceSnapshotMessage).users);
      return;
    }

    if (message.type === "presence:update") {
      applyPresenceEvent(message.data as PresenceUpdateMessage);
    }
  });

  createEffect(() => {
    if (lifecycle.state() === LifecycleState.Connected) {
      ensureClientApiSocketConnected();
    }
  });

  onCleanup(unsubscribe);

  return null;
}
