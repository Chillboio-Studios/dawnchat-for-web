import { createStore } from "solid-js/store";

export type RemoteCallStatus = "Ringing" | "Active" | "Missed" | "Ended";

export type RemoteCallState = {
  channelId: string;
  callId: string;
  status: RemoteCallStatus;
  updatedAt: number;
  startedById?: string;
  updatedById?: string;
  channelType?: "DirectMessage" | "Group";
};

export type PresenceSnapshotUser = {
  userId: string;
  presence?: string;
  status?: {
    presence?: string;
    text?: string;
  };
  updatedAt?: number;
};

export type PresenceUpdate = {
  userId: string;
  presence?: string;
  status?: {
    presence?: string;
    text?: string;
  };
  updatedAt?: number;
};

type ClientApiSocketMessage =
  | {
      type: "dm-ringing:update";
      data: RemoteCallState;
    }
  | {
      type: "dm-ringing:snapshot";
      data: {
        items: unknown[];
      };
    }
  | {
      type: "presence:snapshot";
      data: {
        users: PresenceSnapshotUser[];
      };
    }
  | {
      type: "presence:update";
      data: PresenceUpdate;
    };

const [remoteCallStateByKey, setRemoteCallStateByKey] = createStore<
  Record<string, RemoteCallState>
>({});

const CALL_STATE_PUSH_MAX_ATTEMPTS = 3;
const CALL_STATE_PUSH_RETRY_DELAY_MS = 500;

let socketStarted = false;
let reconnectTimer: number | undefined;
const socketListeners = new Set<(message: ClientApiSocketMessage) => void>();

function createCallKey(channelId: string, callId: string) {
  return `${channelId}:${callId}`;
}

function toWebSocketUrl(pathname: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${pathname}`;
}

function isValidStatus(status: unknown): status is RemoteCallStatus {
  return (
    status === "Ringing" ||
    status === "Active" ||
    status === "Missed" ||
    status === "Ended"
  );
}

function normalizeRemoteCallState(
  payload: unknown,
): RemoteCallState | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const data = payload as {
    channelId?: unknown;
    callId?: unknown;
    status?: unknown;
    updatedAt?: unknown;
    startedById?: unknown;
    updatedById?: unknown;
    channelType?: unknown;
  };

  if (
    typeof data.channelId !== "string" ||
    typeof data.callId !== "string" ||
    !isValidStatus(data.status)
  ) {
    return undefined;
  }

  const normalizedChannelType =
    data.channelType === "DirectMessage" || data.channelType === "Group"
      ? data.channelType
      : undefined;

  // Ringing must always be scoped to DM or Group chats.
  if (data.status === "Ringing" && !normalizedChannelType) {
    return undefined;
  }

  return {
    channelId: data.channelId,
    callId: data.callId,
    status: data.status,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
    startedById:
      typeof data.startedById === "string" ? data.startedById : undefined,
    updatedById:
      typeof data.updatedById === "string" ? data.updatedById : undefined,
    channelType: normalizedChannelType,
  };
}

function setRemoteCallState(item: RemoteCallState) {
  const key = createCallKey(item.channelId, item.callId);
  const previous = remoteCallStateByKey[key];

  // Ignore stale updates so delayed network/socket events cannot rewind state.
  if (previous && previous.updatedAt > item.updatedAt) {
    return;
  }

  setRemoteCallStateByKey(key, item);
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function postRemoteCallState(
  body: Record<string, unknown>,
): Promise<boolean> {
  for (let attempt = 1; attempt <= CALL_STATE_PUSH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch("/client-api/dm-ringing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return true;
      }

      // Request validation/auth failures are not retryable.
      if (response.status >= 400 && response.status < 500) {
        return false;
      }
    } catch {
      // Retry transient network failures.
    }

    if (attempt < CALL_STATE_PUSH_MAX_ATTEMPTS) {
      await wait(CALL_STATE_PUSH_RETRY_DELAY_MS * attempt);
    }
  }

  return false;
}

function emitSocketMessage(message: ClientApiSocketMessage) {
  for (const listener of socketListeners) {
    listener(message);
  }
}

function normalizeSocketMessage(
  payload: unknown,
): ClientApiSocketMessage | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const data = payload as {
    type?: unknown;
    data?: unknown;
    items?: unknown[];
    users?: PresenceSnapshotUser[];
  };

  if (data.type === "dm-ringing:update") {
    const item = normalizeRemoteCallState(data.data ?? payload);
    if (!item) return undefined;

    return {
      type: "dm-ringing:update",
      data: item,
    };
  }

  if (data.type === "dm-ringing:snapshot") {
    const snapshotData =
      data.data &&
      typeof data.data === "object" &&
      Array.isArray((data.data as { items?: unknown[] }).items)
        ? (data.data as { items: unknown[] })
        : { items: Array.isArray(data.items) ? data.items : [] };

    return {
      type: "dm-ringing:snapshot",
      data: snapshotData,
    };
  }

  if (data.type === "presence:snapshot") {
    const payloadData =
      data.data &&
      typeof data.data === "object" &&
      Array.isArray((data.data as { users?: PresenceSnapshotUser[] }).users)
        ? (data.data as { users: PresenceSnapshotUser[] })
        : { users: Array.isArray(data.users) ? data.users : [] };

    return {
      type: "presence:snapshot",
      data: payloadData,
    };
  }

  if (data.type === "presence:update") {
    const eventData =
      data.data && typeof data.data === "object"
        ? (data.data as PresenceUpdate)
        : (payload as PresenceUpdate);

    if (typeof eventData.userId !== "string") return undefined;

    return {
      type: "presence:update",
      data: eventData,
    };
  }

  return undefined;
}

function scheduleReconnect() {
  if (typeof window === "undefined") return;
  if (typeof reconnectTimer !== "undefined") return;

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    socketStarted = false;
    ensureClientApiSocketConnected();
  }, 2000);
}

export function ensureClientApiSocketConnected() {
  if (typeof window === "undefined") return;
  if (socketStarted) return;

  socketStarted = true;

  const ws = new WebSocket(toWebSocketUrl("/client-api/socket"));

  ws.addEventListener("message", (event) => {
    try {
      const message = normalizeSocketMessage(JSON.parse(event.data as string));
      if (!message) return;

      if (message.type === "dm-ringing:update") {
        setRemoteCallState(message.data);
      }

      if (message.type === "dm-ringing:snapshot") {
        for (const rawItem of message.data.items) {
          const item = normalizeRemoteCallState(rawItem);
          if (item) setRemoteCallState(item);
        }
      }

      emitSocketMessage(message);
    } catch {
      // Ignore malformed socket payloads.
    }
  });

  ws.addEventListener("close", () => {
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

export async function fetchRemoteCallState(channelId: string, callId: string) {
  if (typeof window === "undefined") return;

  try {
    const query = new URLSearchParams({ channelId, callId });
    const response = await fetch(`/client-api/dm-ringing?${query.toString()}`);

    if (!response.ok) return;

    const payload = (await response.json()) as { item?: unknown };
    const item = normalizeRemoteCallState(payload.item);
    if (item) setRemoteCallState(item);
  } catch {
    // Ignore transient fetch failures; socket snapshots/updates will reconcile.
  }
}

export async function pushRemoteCallState(
  channelId: string,
  callId: string,
  status: RemoteCallStatus,
  metadata?: {
    startedById?: string;
    updatedById?: string;
    channelType?: "DirectMessage" | "Group";
  },
) {
  if (typeof window === "undefined") return false;

  const updatedAt = Date.now();
  const optimistic = normalizeRemoteCallState({
    channelId,
    callId,
    status,
    startedById: metadata?.startedById,
    updatedById: metadata?.updatedById,
    channelType: metadata?.channelType,
    updatedAt,
  });

  if (optimistic) {
    setRemoteCallState(optimistic);
  }

  const ok = await postRemoteCallState({
    channelId,
    callId,
    status,
    startedById: metadata?.startedById,
    updatedById: metadata?.updatedById,
    channelType: metadata?.channelType,
    updatedAt,
  });

  if (!ok) {
    // Best-effort reconciliation when POST retries fail.
    void fetchRemoteCallState(channelId, callId);
  }

  return ok;
}

export function getAllRemoteCallStates() {
  return Object.values(remoteCallStateByKey);
}

export function getRemoteCallState(channelId?: string, callId?: string) {
  if (!channelId || !callId) return undefined;
  return remoteCallStateByKey[createCallKey(channelId, callId)];
}

export function subscribeClientApiSocket(
  listener: (message: ClientApiSocketMessage) => void,
) {
  socketListeners.add(listener);

  return () => {
    socketListeners.delete(listener);
  };
}
