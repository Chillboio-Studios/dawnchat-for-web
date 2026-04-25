import { createStore } from "solid-js/store";

export type DmCallRingingUpdate = {
  channel_id: string;
  initiator_id: string;
  started_at?: string;
  ended: boolean;
  recipients?: string[];
};

export type RingingCallState = {
  channelId: string;
  startedById: string;
  startedAt: number;
  ended: boolean;
  recipients?: string[];
};

const [ringingByChannel, setRingingByChannel] = createStore<
  Record<string, RingingCallState>
>({});

function toMillis(startedAt?: string) {
  if (!startedAt) return Date.now();
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function applyDmCallRingingUpdate(event: DmCallRingingUpdate) {
  if (!event.channel_id || !event.initiator_id) return;

  setRingingByChannel(event.channel_id, {
    channelId: event.channel_id,
    startedById: event.initiator_id,
    startedAt: toMillis(event.started_at),
    ended: event.ended,
    recipients: event.recipients,
  });
}

export function getRingingState(channelId?: string) {
  if (!channelId) return undefined;
  return ringingByChannel[channelId];
}

export function getAllRingingStates() {
  return Object.values(ringingByChannel);
}
