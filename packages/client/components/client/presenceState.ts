import type { API } from "stoat.js";

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

export function getEffectiveUserStatus(user?: {
  id: string;
  status?: StatusShape;
}) {
  return user?.status;
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
