import type { Session } from "@revolt/state/stores/Auth";

export type ModerationScopes = {
  viewPanel: boolean;
  manageModerators: boolean;
  moderateUsers: boolean;
  moderateMessages: boolean;
  moderateServers: boolean;
  moderateImages: boolean;
  manageCases: boolean;
};

export type ModerationRole = "none" | "owner" | "admin" | "moderator";

export type ModerationBootstrap = {
  userId: string;
  role: ModerationRole;
  scopes: ModerationScopes;
};

export type ModeratorRecord = {
  userId: string;
  role: ModerationRole;
  scopes: ModerationScopes;
  updatedAt: number;
  updatedBy?: string;
};

export type ModerationCase = {
  id: string;
  status: "open" | "investigating" | "resolved" | "dismissed";
  target: {
    type: "user" | "message" | "server" | "image";
    id: string;
  };
  targetSummary?: ModerationTargetSummary;
  reason: string;
  evidence?: string;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
};

export type ModerationTargetSummary = {
  type: "user" | "message" | "server" | "image";
  id: string;
  title: string;
  subtitle?: string;
  avatar?: string | Record<string, unknown>;
  iconURL?: string | Record<string, unknown>;
  imageURL?: string | Record<string, unknown>;
};

export type ModerationCommentAttachment = {
  id?: string;
  url: string;
  filename?: string;
  contentType?: string;
  size?: number;
};

export type ModerationCommentEmbed = {
  id?: string;
  url?: string;
  title?: string;
  description?: string;
  image?: string;
};

export type ModerationReport = {
  id: string;
  status: "open" | "investigating" | "resolved" | "dismissed";
  authorId?: string;
  caseId?: string;
  content: {
    type: "user" | "message" | "server" | "image";
    id: string;
    report_reason?: string;
  };
  targetSummary?: ModerationTargetSummary;
  additional_context?: string;
  notes?: Array<Record<string, unknown>>;
};

export type ModerationReportDetail = ModerationReport & {
  target?:
    | ModerationUserDetail
    | ModerationServerDetail
    | ModerationImageDetail
    | Record<string, unknown>;
  caseItem?: ModerationCase;
  actions?: ModerationAction[];
};

export type ModerationActionType =
  | "warn"
  | "strike"
  | "ban"
  | "unban"
  | "kick"
  | "mute"
  | "unmute"
  | "timeout"
  | "untimeout"
  | "delete_message"
  | "restore_message"
  | "delete_server"
  | "disable_server"
  | "delete_image"
  | "note"
  | "label_user"
  | "clear_flags";

export type ModerationAction = {
  id: string;
  actionType: ModerationActionType;
  targetType: "user" | "message" | "server" | "image";
  targetId: string;
  reason: string;
  caseId?: string;
  performedBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type ModerationUserSearchResult = {
  id: string;
  username?: string;
  discriminator?: string;
  displayName?: string;
  email?: string;
  avatar?: string | Record<string, unknown>;
  createdAt?: number;
};

export type ModerationServerSearchResult = {
  id: string;
  name: string;
  description?: string;
  ownerId?: string;
  iconURL?: string | Record<string, unknown>;
  nsfw?: boolean;
  createdAt?: number;
};

export type ModerationImageSearchResult = {
  id: string;
  filename: string;
  contentType?: string;
  size?: number;
  uploaderId?: string;
  url?: string;
  messageId?: string;
  channelId?: string;
  serverId?: string;
  createdAt?: number;
  removed?: boolean;
};

export type ModerationUserDetail = ModerationUserSearchResult & {
  flags?: Record<string, unknown>;
  badges?: number;
  bot?: boolean;
  privileged?: boolean;
  relationship?: string;
  status?: Record<string, unknown>;
  online?: boolean;
  profile?: Record<string, unknown>;
  moderation?: Record<string, unknown>;
};

export type ModerationUserProfilePatch = {
  username?: string;
  displayName?: string;
  bio?: string;
  badges?: number;
  removeDisplayName?: boolean;
  removeBio?: boolean;
  removeAvatar?: boolean;
  removeBanner?: boolean;
};

export type ModerationUserComment = {
  id: string;
  userId: string;
  body: string;
  attachments?: ModerationCommentAttachment[];
  embeds?: ModerationCommentEmbed[];
  authorId?: string;
  authorUsername?: string;
  createdAt: number;
  updatedAt?: number;
};

export type ModerationServerDetail = ModerationServerSearchResult & {
  banner?: string;
  flags?: number;
  analytics?: Record<string, unknown>;
  channelCount?: number;
  categoryCount?: number;
  moderationDisabled?: boolean;
  moderationDisabledBy?: string;
  moderationDisabledAt?: number;
};

export type ModerationServerProfilePatch = {
  name?: string;
  description?: string;
  flags?: number;
  moderationDisabled?: boolean;
  removeDescription?: boolean;
  removeIcon?: boolean;
  removeBanner?: boolean;
};

export type ModerationServerComment = {
  id: string;
  serverId: string;
  body: string;
  attachments?: ModerationCommentAttachment[];
  embeds?: ModerationCommentEmbed[];
  authorId?: string;
  authorUsername?: string;
  createdAt: number;
  updatedAt?: number;
};

export type ModerationImageComment = {
  id: string;
  imageId: string;
  body: string;
  attachments?: ModerationCommentAttachment[];
  embeds?: ModerationCommentEmbed[];
  authorId?: string;
  authorUsername?: string;
  createdAt: number;
  updatedAt?: number;
};

export type ModerationImageDetail = ModerationImageSearchResult & {
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
  removedBy?: string;
  removedAt?: number;
  caseId?: string;
};

export type ModerationPagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

type AuthHeaders = {
  "x-client-user-id": string;
  "x-client-session-token": string;
};

function toAuthHeaders(session: Session): AuthHeaders {
  return {
    "x-client-user-id": session.userId,
    "x-client-session-token": session.token,
  };
}

async function request<T>(
  session: Session,
  path: string,
  legacyPath?: string,
  options?: Omit<RequestInit, "headers"> & {
    headers?: Record<string, string>;
  },
): Promise<T> {
  const execute = async (requestPath: string) =>
    fetch(requestPath, {
      ...options,
      headers: {
        ...toAuthHeaders(session),
        ...options?.headers,
      },
    });

  let response = await execute(path);

  // Legacy fallback allows older and newer client/server combinations to interoperate.
  if (response.status === 404 && legacyPath) {
    response = await execute(legacyPath);
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        message = payload.error;
      }
    } catch {
      // Ignore decode errors and preserve fallback message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function fetchModerationBootstrap(session: Session) {
  return request<{ item: ModerationBootstrap }>(
    session,
    "/client-api/moderation/bootstrap",
    "/client-api/moderation/legacy/bootstrap",
  );
}

export async function fetchModerators(session: Session) {
  return request<{ items: ModeratorRecord[] }>(
    session,
    "/client-api/moderation/moderators",
    "/client-api/moderation/legacy/moderators",
  );
}

export async function upsertModerator(
  session: Session,
  payload: {
    userId: string;
    role: "owner" | "admin" | "moderator";
    scopes?: Partial<ModerationScopes>;
  },
) {
  return request<{ item: ModeratorRecord }>(
    session,
    "/client-api/moderation/moderators",
    "/client-api/moderation/legacy/moderators",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function removeModerator(session: Session, userId: string) {
  return request<{ ok: true }>(
    session,
    `/client-api/moderation/moderators/${encodeURIComponent(userId)}`,
    `/client-api/moderation/legacy/moderators/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function fetchModerationCases(
  session: Session,
  filters?: {
    targetType?: "user" | "message" | "server" | "image";
    targetId?: string;
    status?: "open" | "investigating" | "resolved" | "dismissed";
    query?: string;
    page?: number;
    limit?: number;
    sortBy?: "createdAt" | "updatedAt" | "status";
    sortDirection?: "asc" | "desc";
  },
) {
  const query = new URLSearchParams();

  if (filters?.targetType) query.set("targetType", filters.targetType);
  if (filters?.targetId) query.set("targetId", filters.targetId);
  if (filters?.status) query.set("status", filters.status);
  if (filters?.query) query.set("query", filters.query);
  if (typeof filters?.page === "number") {
    query.set("page", String(filters.page));
  }
  if (typeof filters?.limit === "number") {
    query.set("limit", String(filters.limit));
  }
  if (filters?.sortBy) query.set("sortBy", filters.sortBy);
  if (filters?.sortDirection) query.set("sortDirection", filters.sortDirection);

  return request<ModerationPagedResponse<ModerationCase>>(
    session,
    `/client-api/moderation/cases${query.size ? `?${query.toString()}` : ""}`,
    `/client-api/moderation/legacy/cases${query.size ? `?${query.toString()}` : ""}`,
  );
}

export async function updateModerationCaseStatus(
  session: Session,
  caseId: string,
  status: "open" | "investigating" | "resolved" | "dismissed",
  note?: string,
) {
  return request<{ item: ModerationCase }>(
    session,
    `/client-api/moderation/cases/${encodeURIComponent(caseId)}/status`,
    `/client-api/moderation/legacy/cases/${encodeURIComponent(caseId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, note }),
    },
  );
}

export async function fetchModerationReports(
  session: Session,
  filters?: {
    targetType?: "user" | "message" | "server" | "image";
    targetId?: string;
    status?: "open" | "investigating" | "resolved" | "dismissed";
    query?: string;
    page?: number;
    limit?: number;
    sortBy?: "createdAt" | "updatedAt" | "status";
    sortDirection?: "asc" | "desc";
  },
) {
  const query = new URLSearchParams();

  if (filters?.targetType) query.set("targetType", filters.targetType);
  if (filters?.targetId) query.set("targetId", filters.targetId);
  if (filters?.status) query.set("status", filters.status);
  if (filters?.query) query.set("query", filters.query);
  if (typeof filters?.page === "number") {
    query.set("page", String(filters.page));
  }
  if (typeof filters?.limit === "number") {
    query.set("limit", String(filters.limit));
  }
  if (filters?.sortBy) query.set("sortBy", filters.sortBy);
  if (filters?.sortDirection) query.set("sortDirection", filters.sortDirection);

  const suffix = query.size ? `?${query.toString()}` : "";

  return request<ModerationPagedResponse<ModerationReport>>(
    session,
    `/client-api/moderation/reports${suffix}`,
    `/client-api/moderation/legacy/reports${suffix}`,
  );
}

export async function fetchModerationReportDetail(
  session: Session,
  reportId: string,
) {
  return request<{ item: ModerationReportDetail }>(
    session,
    `/client-api/moderation/reports/${encodeURIComponent(reportId)}`,
    `/client-api/moderation/legacy/reports/${encodeURIComponent(reportId)}`,
  );
}

export async function createModerationReport(
  session: Session,
  payload: {
    targetType: "user" | "message" | "server" | "image";
    targetId: string;
    reportReason?: string;
    additionalContext?: string;
    autoCreateCase?: boolean;
  },
) {
  return request<{ item: ModerationReport }>(
    session,
    "/client-api/moderation/reports",
    "/client-api/moderation/legacy/reports",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function updateModerationReportStatus(
  session: Session,
  reportId: string,
  status: "open" | "investigating" | "resolved" | "dismissed",
  note?: string,
) {
  return request<{ item: ModerationReportDetail }>(
    session,
    `/client-api/moderation/reports/${encodeURIComponent(reportId)}/status`,
    `/client-api/moderation/legacy/reports/${encodeURIComponent(reportId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, note }),
    },
  );
}

export async function applyModerationAction(
  session: Session,
  payload: {
    actionType: ModerationActionType;
    targetType: "user" | "message" | "server" | "image";
    targetId: string;
    reason: string;
    evidence?: string;
    caseId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return request<{
    ok: true;
    action: ModerationAction;
    caseItem?: ModerationCase;
  }>(
    session,
    "/client-api/moderation/actions",
    "/client-api/moderation/legacy/actions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function applyBulkModerationAction(
  session: Session,
  payload: {
    actionType: ModerationActionType;
    reason: string;
    targets: Array<{
      targetType: "user" | "message" | "server" | "image";
      targetId: string;
    }>;
    evidence?: string;
    caseId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return request<{
    ok: true;
    count: number;
    items: Array<{
      action: ModerationAction;
      caseItem?: ModerationCase;
    }>;
  }>(
    session,
    "/client-api/moderation/actions/bulk",
    "/client-api/moderation/legacy/actions/bulk",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchModerationActions(
  session: Session,
  filters?: {
    targetType?: "user" | "message" | "server" | "image";
    targetId?: string;
    query?: string;
    page?: number;
    limit?: number;
    sortBy?: "createdAt" | "reason";
    sortDirection?: "asc" | "desc";
  },
) {
  const query = new URLSearchParams();
  if (filters?.targetType) query.set("targetType", filters.targetType);
  if (filters?.targetId) query.set("targetId", filters.targetId);
  if (filters?.query) query.set("query", filters.query);
  if (typeof filters?.page === "number") {
    query.set("page", String(filters.page));
  }
  if (typeof filters?.limit === "number") {
    query.set("limit", String(filters.limit));
  }
  if (filters?.sortBy) query.set("sortBy", filters.sortBy);
  if (filters?.sortDirection) query.set("sortDirection", filters.sortDirection);

  const suffix = query.size ? `?${query.toString()}` : "";

  return request<ModerationPagedResponse<ModerationAction>>(
    session,
    `/client-api/moderation/actions${suffix}`,
    `/client-api/moderation/legacy/actions${suffix}`,
  );
}

export async function searchModerationUsers(
  session: Session,
  queryText: string,
  filters?: {
    page?: number;
    limit?: number;
    sortBy?: "username" | "createdAt";
    sortDirection?: "asc" | "desc";
  },
) {
  const query = new URLSearchParams();
  query.set("query", queryText);
  query.set("page", String(filters?.page ?? 1));
  query.set("limit", String(filters?.limit ?? 25));
  if (filters?.sortBy) query.set("sortBy", filters.sortBy);
  if (filters?.sortDirection) query.set("sortDirection", filters.sortDirection);

  return request<ModerationPagedResponse<ModerationUserSearchResult>>(
    session,
    `/client-api/moderation/search/users?${query.toString()}`,
    `/client-api/moderation/legacy/search/users?${query.toString()}`,
  );
}

export async function searchModerationServers(
  session: Session,
  queryText: string,
  filters?: {
    page?: number;
    limit?: number;
    sortBy?: "name" | "createdAt";
    sortDirection?: "asc" | "desc";
  },
) {
  const query = new URLSearchParams();
  query.set("query", queryText);
  query.set("page", String(filters?.page ?? 1));
  query.set("limit", String(filters?.limit ?? 25));
  if (filters?.sortBy) query.set("sortBy", filters.sortBy);
  if (filters?.sortDirection) query.set("sortDirection", filters.sortDirection);

  return request<ModerationPagedResponse<ModerationServerSearchResult>>(
    session,
    `/client-api/moderation/search/servers?${query.toString()}`,
    `/client-api/moderation/legacy/search/servers?${query.toString()}`,
  );
}

export async function searchModerationImages(
  session: Session,
  queryText: string,
  filters?: {
    page?: number;
    limit?: number;
    sortBy?: "createdAt" | "filename";
    sortDirection?: "asc" | "desc";
  },
) {
  const query = new URLSearchParams();
  query.set("query", queryText);
  query.set("page", String(filters?.page ?? 1));
  query.set("limit", String(filters?.limit ?? 25));
  if (filters?.sortBy) query.set("sortBy", filters.sortBy);
  if (filters?.sortDirection) query.set("sortDirection", filters.sortDirection);

  return request<ModerationPagedResponse<ModerationImageSearchResult>>(
    session,
    `/client-api/moderation/search/images?${query.toString()}`,
    `/client-api/moderation/legacy/search/images?${query.toString()}`,
  );
}

export async function fetchModerationUserDetail(
  session: Session,
  userId: string,
) {
  return request<{ item: ModerationUserDetail }>(
    session,
    `/client-api/moderation/view/users/${encodeURIComponent(userId)}`,
    `/client-api/moderation/legacy/view/users/${encodeURIComponent(userId)}`,
  );
}

export async function updateModerationUserProfile(
  session: Session,
  userId: string,
  payload: ModerationUserProfilePatch,
) {
  return request<{ item: ModerationUserDetail }>(
    session,
    `/client-api/moderation/view/users/${encodeURIComponent(userId)}`,
    `/client-api/moderation/legacy/view/users/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchModerationUserComments(
  session: Session,
  userId: string,
  limit = 100,
) {
  const query = new URLSearchParams();
  query.set("limit", String(limit));

  return request<{ items: ModerationUserComment[] }>(
    session,
    `/client-api/moderation/view/users/${encodeURIComponent(userId)}/comments?${query.toString()}`,
    `/client-api/moderation/legacy/view/users/${encodeURIComponent(userId)}/comments?${query.toString()}`,
  );
}

export async function createModerationUserComment(
  session: Session,
  userId: string,
  body: string,
  extras?: {
    attachments?: ModerationCommentAttachment[];
    embeds?: ModerationCommentEmbed[];
  },
) {
  return request<{ item: ModerationUserComment }>(
    session,
    `/client-api/moderation/view/users/${encodeURIComponent(userId)}/comments`,
    `/client-api/moderation/legacy/view/users/${encodeURIComponent(userId)}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body,
        attachments: extras?.attachments,
        embeds: extras?.embeds,
      }),
    },
  );
}

export async function fetchModerationServerDetail(
  session: Session,
  serverId: string,
) {
  return request<{ item: ModerationServerDetail }>(
    session,
    `/client-api/moderation/view/servers/${encodeURIComponent(serverId)}`,
    `/client-api/moderation/legacy/view/servers/${encodeURIComponent(serverId)}`,
  );
}

export async function updateModerationServerProfile(
  session: Session,
  serverId: string,
  payload: ModerationServerProfilePatch,
) {
  return request<{ item: ModerationServerDetail }>(
    session,
    `/client-api/moderation/view/servers/${encodeURIComponent(serverId)}`,
    `/client-api/moderation/legacy/view/servers/${encodeURIComponent(serverId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchModerationServerComments(
  session: Session,
  serverId: string,
  limit = 100,
) {
  const query = new URLSearchParams();
  query.set("limit", String(limit));

  return request<{ items: ModerationServerComment[] }>(
    session,
    `/client-api/moderation/view/servers/${encodeURIComponent(serverId)}/comments?${query.toString()}`,
    `/client-api/moderation/legacy/view/servers/${encodeURIComponent(serverId)}/comments?${query.toString()}`,
  );
}

export async function createModerationServerComment(
  session: Session,
  serverId: string,
  body: string,
  extras?: {
    attachments?: ModerationCommentAttachment[];
    embeds?: ModerationCommentEmbed[];
  },
) {
  return request<{ item: ModerationServerComment }>(
    session,
    `/client-api/moderation/view/servers/${encodeURIComponent(serverId)}/comments`,
    `/client-api/moderation/legacy/view/servers/${encodeURIComponent(serverId)}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body,
        attachments: extras?.attachments,
        embeds: extras?.embeds,
      }),
    },
  );
}

export async function fetchModerationImageDetail(
  session: Session,
  imageId: string,
) {
  return request<{ item: ModerationImageDetail }>(
    session,
    `/client-api/moderation/view/images/${encodeURIComponent(imageId)}`,
    `/client-api/moderation/legacy/view/images/${encodeURIComponent(imageId)}`,
  );
}

export async function fetchModerationImageComments(
  session: Session,
  imageId: string,
  limit = 100,
) {
  const query = new URLSearchParams();
  query.set("limit", String(limit));

  return request<{ items: ModerationImageComment[] }>(
    session,
    `/client-api/moderation/view/images/${encodeURIComponent(imageId)}/comments?${query.toString()}`,
    `/client-api/moderation/legacy/view/images/${encodeURIComponent(imageId)}/comments?${query.toString()}`,
  );
}

export async function createModerationImageComment(
  session: Session,
  imageId: string,
  body: string,
  extras?: {
    attachments?: ModerationCommentAttachment[];
    embeds?: ModerationCommentEmbed[];
  },
) {
  return request<{ item: ModerationImageComment }>(
    session,
    `/client-api/moderation/view/images/${encodeURIComponent(imageId)}/comments`,
    `/client-api/moderation/legacy/view/images/${encodeURIComponent(imageId)}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body,
        attachments: extras?.attachments,
        embeds: extras?.embeds,
      }),
    },
  );
}
