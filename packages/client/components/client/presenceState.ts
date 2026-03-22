import type { API } from "stoat.js";
import { createStore } from "solid-js/store";

type StatusShape = {
  presence?: API.Presence;
  text?: string;
};

export type PresenceEvent = {
  userId: string;
  presence?: API.Presence;
  status?: StatusShape;
  updatedAt?: number;
};

const [presenceByUserId, setPresenceByUserId] = createStore<
  Record<string, PresenceEvent>
>({});

function normalise(event: PresenceEvent): PresenceEvent | undefined {
  const userId = String(event.userId ?? "").trim();
  if (!userId) return undefined;

  const status = {
    ...(event.status ?? {}),
  };

  if (typeof event.presence === "string") {
    status.presence = event.presence;
  }

  return {
    userId,
    presence: status.presence,
    status,
    updatedAt: event.updatedAt ?? Date.now(),
  };
}

export function replacePresenceSnapshot(events: PresenceEvent[]) {
  const nextState = events.reduce((acc, event) => {
    const normalised = normalise(event);
    if (normalised) {
      acc[normalised.userId] = normalised;
    }

    return acc;
  }, {} as Record<string, PresenceEvent>);

  setPresenceByUserId(nextState);
}

export function applyPresenceEvent(event: PresenceEvent) {
  const normalised = normalise(event);
  if (!normalised) return;

  setPresenceByUserId(normalised.userId, (existing: PresenceEvent | undefined) => ({
    ...(existing ?? {}),
    ...normalised,
    status: {
      ...(existing?.status ?? {}),
      ...(normalised.status ?? {}),
    },
  }));
}

export function getEffectiveUserStatus(user?: {
  id: string;
  status?: StatusShape;
}) {
  if (!user) return undefined;

  const update = presenceByUserId[user.id];
  if (!update) return user.status;

  return {
    ...(user.status ?? {}),
    ...(update.status ?? {}),
  };
}

export function getEffectiveUserPresence(user?: {
  id: string;
  presence?: API.Presence;
  status?: StatusShape;
}) {
  if (!user) return "Invisible";

  const status = getEffectiveUserStatus(user);

  return status?.presence ?? user.status?.presence ?? user.presence ?? "Invisible";
}
