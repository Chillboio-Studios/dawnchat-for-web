import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { styled } from "styled-system/jsx";

import {
  type ModerationAction,
  type ModerationActionType,
  type ModerationBootstrap,
  type ModerationCase,
  type ModerationCommentAttachment,
  type ModerationCommentEmbed,
  type ModerationImageComment,
  type ModerationImageDetail,
  type ModerationImageSearchResult,
  type ModerationReport,
  type ModerationReportDetail,
  type ModerationServerComment,
  type ModerationServerDetail,
  type ModerationServerProfilePatch,
  type ModerationServerSearchResult,
  type ModerationTargetSummary,
  type ModerationUserComment,
  type ModerationUserDetail,
  type ModerationUserProfilePatch,
  type ModerationUserSearchResult,
  type ModeratorRecord,
  applyModerationAction,
  createModerationImageComment,
  createModerationReport,
  createModerationServerComment,
  createModerationUserComment,
  fetchModerationActions,
  fetchModerationBootstrap,
  fetchModerationCases,
  fetchModerationImageComments,
  fetchModerationImageDetail,
  fetchModerationReportDetail,
  fetchModerationReports,
  fetchModerationServerComments,
  fetchModerationServerDetail,
  fetchModerationUserComments,
  fetchModerationUserDetail,
  fetchModerators,
  removeModerator,
  searchModerationImages,
  searchModerationServers,
  searchModerationUsers,
  updateModerationCaseStatus,
  updateModerationReportStatus,
  updateModerationServerProfile,
  updateModerationUserProfile,
  upsertModerator,
} from "../../components/common/lib/moderationApi";

import { CONFIGURATION } from "@revolt/common";
import { Markdown } from "@revolt/markdown";
import { useNavigate, useParams } from "@revolt/routing";
import { useState } from "@revolt/state";
import { Column, Text } from "@revolt/ui";

const ACTION_TYPES = [
  "warn",
  "strike",
  "ban",
  "unban",
  "kick",
  "mute",
  "unmute",
  "timeout",
  "untimeout",
  "delete_message",
  "restore_message",
  "delete_server",
  "disable_server",
  "delete_image",
  "note",
  "label_user",
  "clear_flags",
] as const;

const CASE_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "dismissed",
] as const;

const STAGES = [
  { key: "intel", label: "Overview" },
  { key: "module", label: "Full List" },
  { key: "cases", label: "Cases & Reports" },
  { key: "staff", label: "Team" },
] as const;

const INSPECTOR_REASON_PRESETS = {
  warn: [
    "Initial policy warning: spam behavior",
    "Initial policy warning: harassment language",
    "Initial policy warning: impersonation risk",
  ],
  strike: [
    "Strike issued: repeated spam after warning",
    "Strike issued: abusive behavior in chat",
    "Strike issued: repeat account misuse",
  ],
  timeout: [
    "Temporary suspension: harassment and escalation",
    "Temporary suspension: repeat policy violations",
    "Temporary suspension pending moderator review",
  ],
  ban: [
    "Permanent ban: severe harassment",
    "Permanent ban: coordinated abuse activity",
    "Permanent ban: repeat violations despite prior action",
  ],
} as const;

const USER_BADGE_BITS = [
  { label: "Developer", value: 1 },
  { label: "Translator", value: 2 },
  { label: "Supporter", value: 4 },
  { label: "Responsible Disclosure", value: 8 },
  { label: "Founder", value: 16 },
  { label: "Platform Moderation", value: 32 },
  { label: "Active Supporter", value: 64 },
  { label: "Paw", value: 128 },
  { label: "Early Adopter", value: 256 },
  { label: "Joke Badge 1", value: 512 },
  { label: "Joke Badge 2", value: 1024 },
] as const;

const SERVER_BADGE_BITS = [
  { label: "Official", value: 1 },
  { label: "Verified", value: 2 },
] as const;

const SERVER_INSPECTOR_REASON_PRESETS = {
  disable_server: [
    "Server disabled for policy and safety review",
    "Server disabled due to sustained abuse reports",
  ],
  delete_server: [
    "Server removed for severe policy violations",
    "Server removed after repeated enforcement failures",
  ],
} as const;

type TargetType = "user" | "message" | "server" | "image";
type CaseStatus = (typeof CASE_STATUSES)[number];
type ActionType = (typeof ACTION_TYPES)[number] & ModerationActionType;
type StageKey =
  | (typeof STAGES)[number]["key"]
  | "inspector"
  | "serverInspector"
  | "imageInspector";

type SearchType = "user" | "server" | "image";
type ModuleType = "user" | "server" | "image";

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  type: ModuleType;
};

type TargetSummaryContainer = {
  content: {
    type: "user" | "message" | "server" | "image";
    id: string;
  };
  targetSummary?: ModerationTargetSummary;
};

function getAssetId(asset: unknown): string | undefined {
  if (typeof asset === "string" && asset.trim()) {
    return asset;
  }

  if (!asset || typeof asset !== "object") {
    return undefined;
  }

  const record = asset as Record<string, unknown>;
  const id = record._id ?? record.id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function toMediaUrl(
  bucket: "avatars" | "icons" | "backgrounds" | "banners",
  asset: unknown,
): string | undefined {
  const id = getAssetId(asset);
  if (!id) {
    return undefined;
  }

  if (/^https?:\/\//i.test(id)) {
    return id;
  }

  return `${CONFIGURATION.DEFAULT_MEDIA_URL}/${bucket}/${id}`;
}

function toAttachmentMediaUrl(asset: unknown): string | undefined {
  const id = getAssetId(asset);
  if (!id) {
    return undefined;
  }

  if (/^https?:\/\//i.test(id)) {
    return id;
  }

  return `${CONFIGURATION.DEFAULT_MEDIA_URL}/attachments/${id}`;
}

function formatBytes(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "unknown";
  }

  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function normalizeHttpUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function parseCommentAttachmentInput(
  value: string,
): ModerationCommentAttachment[] {
  const entries = value
    .split("\n")
    .map((line) => normalizeHttpUrl(line))
    .filter(Boolean)
    .slice(0, 12);

  return entries.map((url) => ({ url }));
}

function parseCommentEmbedInput(value: string): ModerationCommentEmbed[] {
  const entries = value
    .split("\n")
    .map((line) => normalizeHttpUrl(line))
    .filter(Boolean)
    .slice(0, 12);

  return entries.map((url) => ({
    url,
    title: url,
  }));
}

function getReportTargetSummary(entry: TargetSummaryContainer): {
  title: string;
  subtitle?: string;
  avatar?: string | Record<string, unknown>;
  iconURL?: string | Record<string, unknown>;
  imageURL?: string | Record<string, unknown>;
  type: TargetType;
  id: string;
} {
  const summary = entry.targetSummary;

  if (summary) {
    return {
      title: summary.title,
      subtitle: summary.subtitle,
      avatar: summary.avatar,
      iconURL: summary.iconURL,
      imageURL: summary.imageURL,
      type: summary.type,
      id: summary.id,
    };
  }

  return {
    title: entry.content.id,
    type: entry.content.type,
    id: entry.content.id,
  };
}

function getSummaryPrimaryMedia(summary: {
  type: TargetType;
  avatar?: string | Record<string, unknown>;
  iconURL?: string | Record<string, unknown>;
  imageURL?: string | Record<string, unknown>;
}): string | undefined {
  if (summary.type === "user") {
    return toMediaUrl("avatars", summary.avatar);
  }

  if (summary.type === "server") {
    return toMediaUrl("icons", summary.iconURL);
  }

  if (summary.type === "image") {
    return toAttachmentMediaUrl(summary.imageURL);
  }

  return undefined;
}

function isLikelyImageUrl(url?: string): boolean {
  if (!url) return false;
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url);
}

export function ModerationView() {
  const state = useState();
  const navigate = useNavigate();
  const params = useParams<{ targetType?: string; targetId?: string }>();

  const [stage, setStage] = createSignal<StageKey>("intel");
  const [loading, setLoading] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal("");

  const [bootstrap, setBootstrap] = createSignal<ModerationBootstrap>();
  const [moderators, setModerators] = createSignal<ModeratorRecord[]>([]);
  const [cases, setCases] = createSignal<ModerationCase[]>([]);
  const [reports, setReports] = createSignal<ModerationReport[]>([]);
  const [actions, setActions] = createSignal<ModerationAction[]>([]);

  const [selectedReportId, setSelectedReportId] = createSignal("");
  const [selectedReport, setSelectedReport] =
    createSignal<ModerationReportDetail>();
  const [reportStatusNote, setReportStatusNote] = createSignal("");
  const [newReportReason, setNewReportReason] = createSignal("");
  const [newReportContext, setNewReportContext] = createSignal("");

  const [searchType, setSearchType] = createSignal<SearchType>("user");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<SearchResult[]>([]);
  const [moduleType, setModuleType] = createSignal<ModuleType>("user");
  const [modulePage, setModulePage] = createSignal(1);
  const [moduleList, setModuleList] = createSignal<SearchResult[]>([]);
  const [moduleTotal, setModuleTotal] = createSignal(0);
  const moduleLimit = 50;

  const [targetType, setTargetType] = createSignal<TargetType>("user");
  const [targetId, setTargetId] = createSignal("");
  const [actionType, setActionType] = createSignal<ActionType>("warn");
  const [actionReason, setActionReason] = createSignal("");
  const [actionEvidence, setActionEvidence] = createSignal("");
  const [inspectedUser, setInspectedUser] =
    createSignal<ModerationUserDetail>();
  const [profileUsername, setProfileUsername] = createSignal("");
  const [profileDisplayName, setProfileDisplayName] = createSignal("");
  const [profileBio, setProfileBio] = createSignal("");
  const [userBadgeBitfield, setUserBadgeBitfield] = createSignal(0);
  const [inspectorActions, setInspectorActions] = createSignal<
    ModerationAction[]
  >([]);
  const [userComments, setUserComments] = createSignal<ModerationUserComment[]>(
    [],
  );
  const [newCommentBody, setNewCommentBody] = createSignal("");
  const [newCommentAttachments, setNewCommentAttachments] = createSignal("");
  const [newCommentEmbeds, setNewCommentEmbeds] = createSignal("");
  const [inspectedServer, setInspectedServer] =
    createSignal<ModerationServerDetail>();
  const [serverName, setServerName] = createSignal("");
  const [serverDescription, setServerDescription] = createSignal("");
  const [serverBadgeBitfield, setServerBadgeBitfield] = createSignal(0);
  const [serverInspectorActions, setServerInspectorActions] = createSignal<
    ModerationAction[]
  >([]);
  const [serverComments, setServerComments] = createSignal<
    ModerationServerComment[]
  >([]);
  const [newServerCommentBody, setNewServerCommentBody] = createSignal("");
  const [newServerCommentAttachments, setNewServerCommentAttachments] =
    createSignal("");
  const [newServerCommentEmbeds, setNewServerCommentEmbeds] = createSignal("");
  const [inspectedImage, setInspectedImage] =
    createSignal<ModerationImageDetail>();
  const [imageInspectorActions, setImageInspectorActions] = createSignal<
    ModerationAction[]
  >([]);
  const [imageComments, setImageComments] = createSignal<
    ModerationImageComment[]
  >([]);
  const [newImageCommentBody, setNewImageCommentBody] = createSignal("");
  const [newImageCommentAttachments, setNewImageCommentAttachments] =
    createSignal("");
  const [newImageCommentEmbeds, setNewImageCommentEmbeds] = createSignal("");

  const [moderatorUserId, setModeratorUserId] = createSignal("");
  const [moderatorRole, setModeratorRole] = createSignal<
    "owner" | "admin" | "moderator"
  >("moderator");

  const session = () => state.auth.getSession();

  createEffect(() => {
    const routeType = (params.targetType || "").trim();
    const routeId = (params.targetId || "").trim();

    if (
      routeType === "user" ||
      routeType === "message" ||
      routeType === "server" ||
      routeType === "image"
    ) {
      setTargetType(routeType);
      setTargetId(routeId);

      if (routeType === "user") {
        setStage("inspector");
        void loadUserInspector(routeId);
      } else if (routeType === "server") {
        setStage("serverInspector");
        void loadServerInspector(routeId);
      } else if (routeType === "image") {
        setStage("imageInspector");
        void loadImageInspector(routeId);
      } else {
        setStage("cases");
      }
    }
  });

  const canViewPanel = createMemo(() => Boolean(bootstrap()?.scopes.viewPanel));

  const caseTotals = createMemo(() => {
    const entries = cases();
    return {
      total: entries.length,
      open: entries.filter((entry) => entry.status === "open").length,
      investigating: entries.filter((entry) => entry.status === "investigating")
        .length,
      resolved: entries.filter((entry) => entry.status === "resolved").length,
      dismissed: entries.filter((entry) => entry.status === "dismissed").length,
    };
  });

  const latestCases = createMemo(() => cases().slice(0, 8));
  const activeReports = createMemo(() =>
    reports().filter(
      (entry) => entry.status === "open" || entry.status === "investigating",
    ),
  );
  const resolvedReports = createMemo(() =>
    reports().filter((entry) => entry.status === "resolved"),
  );
  const dismissedReports = createMemo(() =>
    reports().filter((entry) => entry.status === "dismissed"),
  );
  const reportTotals = createMemo(() => {
    const entries = reports();
    return {
      total: entries.length,
      open: entries.filter((entry) => entry.status === "open").length,
      investigating: entries.filter((entry) => entry.status === "investigating")
        .length,
      resolved: entries.filter((entry) => entry.status === "resolved").length,
      dismissed: entries.filter((entry) => entry.status === "dismissed").length,
    };
  });

  const casesByStatus = createMemo(() => ({
    open: cases().filter((entry) => entry.status === "open"),
    investigating: cases().filter((entry) => entry.status === "investigating"),
    resolved: cases().filter((entry) => entry.status === "resolved"),
    dismissed: cases().filter((entry) => entry.status === "dismissed"),
  }));

  function renderDiscussionTimeline(
    comments: Array<
      ModerationUserComment | ModerationServerComment | ModerationImageComment
    >,
  ) {
    return (
      <Timeline>
        <For each={comments}>
          {(comment) => (
            <TimelineItem>
              <TimelineMarkdown>
                <Markdown content={comment.body} />
              </TimelineMarkdown>

              <Show when={(comment.attachments?.length ?? 0) > 0}>
                <CommentAssetGrid>
                  <For each={comment.attachments || []}>
                    {(attachment) => (
                      <CommentAssetCard>
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {attachment.filename || attachment.url}
                        </a>
                        <Show when={isLikelyImageUrl(attachment.url)}>
                          <CommentAssetImage
                            src={attachment.url}
                            alt={attachment.filename || "Attachment preview"}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </Show>
                      </CommentAssetCard>
                    )}
                  </For>
                </CommentAssetGrid>
              </Show>

              <Show when={(comment.embeds?.length ?? 0) > 0}>
                <CommentAssetGrid>
                  <For each={comment.embeds || []}>
                    {(embed) => (
                      <CommentAssetCard>
                        <Show when={embed.url}>
                          <a href={embed.url} target="_blank" rel="noreferrer">
                            {embed.title || embed.url}
                          </a>
                        </Show>
                        <Show when={!embed.url && embed.title}>
                          <Text>
                            <strong>{embed.title}</strong>
                          </Text>
                        </Show>
                        <Show when={embed.description}>
                          <Muted>{embed.description}</Muted>
                        </Show>
                        <Show when={embed.image}>
                          <CommentAssetImage
                            src={embed.image!}
                            alt={embed.title || "Embed image"}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        </Show>
                      </CommentAssetCard>
                    )}
                  </For>
                </CommentAssetGrid>
              </Show>

              <TimelineMeta>
                by {comment.authorUsername || comment.authorId || "unknown"} |{" "}
                {new Date(comment.createdAt).toLocaleString()}
              </TimelineMeta>
            </TimelineItem>
          )}
        </For>
      </Timeline>
    );
  }

  async function refresh() {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const [
        bootstrapPayload,
        moderatorsPayload,
        casesPayload,
        reportsPayload,
        actionsPayload,
      ] = await Promise.all([
        fetchModerationBootstrap(currentSession),
        fetchModerators(currentSession),
        fetchModerationCases(currentSession, {
          limit: 120,
          sortBy: "updatedAt",
          sortDirection: "desc",
        }),
        fetchModerationReports(currentSession, {
          limit: 120,
          sortBy: "updatedAt",
          sortDirection: "desc",
        }),
        fetchModerationActions(currentSession, {
          limit: 40,
          sortBy: "createdAt",
          sortDirection: "desc",
        }),
      ]);

      setBootstrap(bootstrapPayload.item);
      setModerators(moderatorsPayload.items);
      setCases(casesPayload.items);
      setReports(reportsPayload.items);
      setActions(actionsPayload.items);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load moderation workspace",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadReportDetails(reportId: string) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await fetchModerationReportDetail(
        currentSession,
        reportId,
      );
      setSelectedReportId(reportId);
      setSelectedReport(payload.item);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load report details",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadUserInspector(userId: string) {
    const currentSession = session();
    if (!currentSession || !userId) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await fetchModerationUserDetail(currentSession, userId);
      setInspectedUser(payload.item);
      setProfileUsername(payload.item.username ?? "");
      setProfileDisplayName(
        typeof payload.item.displayName === "string"
          ? payload.item.displayName
          : "",
      );
      setProfileBio(
        typeof payload.item.profile?.content === "string"
          ? String(payload.item.profile.content)
          : "",
      );
      setUserBadgeBitfield(
        typeof payload.item.badges === "number" ? payload.item.badges : 0,
      );

      const [actionPayload, commentsPayload] = await Promise.all([
        fetchModerationActions(currentSession, {
          targetType: "user",
          targetId: userId,
          limit: 100,
          sortBy: "createdAt",
          sortDirection: "desc",
        }),
        fetchModerationUserComments(currentSession, userId, 100),
      ]);

      setInspectorActions(actionPayload.items);
      setUserComments(commentsPayload.items);
      setTargetType("user");
      setTargetId(userId);
      setStage("inspector");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load user inspector",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadServerInspector(serverId: string) {
    const currentSession = session();
    if (!currentSession || !serverId) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await fetchModerationServerDetail(
        currentSession,
        serverId,
      );
      setInspectedServer(payload.item);
      setServerName(payload.item.name ?? "");
      setServerDescription(payload.item.description ?? "");
      setServerBadgeBitfield(
        typeof payload.item.flags === "number" ? payload.item.flags : 0,
      );

      const [actionPayload, commentsPayload] = await Promise.all([
        fetchModerationActions(currentSession, {
          targetType: "server",
          targetId: serverId,
          limit: 100,
          sortBy: "createdAt",
          sortDirection: "desc",
        }),
        fetchModerationServerComments(currentSession, serverId, 100),
      ]);

      setServerInspectorActions(actionPayload.items);
      setServerComments(commentsPayload.items);
      setTargetType("server");
      setTargetId(serverId);
      setStage("serverInspector");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load server inspector",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadImageInspector(imageId: string) {
    const currentSession = session();
    if (!currentSession || !imageId) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await fetchModerationImageDetail(currentSession, imageId);
      setInspectedImage(payload.item);

      const [actionPayload, commentsPayload] = await Promise.all([
        fetchModerationActions(currentSession, {
          targetType: "image",
          targetId: imageId,
          limit: 100,
          sortBy: "createdAt",
          sortDirection: "desc",
        }),
        fetchModerationImageComments(currentSession, imageId, 100),
      ]);

      setImageInspectorActions(actionPayload.items);
      setImageComments(commentsPayload.items);
      setTargetType("image");
      setTargetId(imageId);
      setStage("imageInspector");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load image inspector",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadModuleListing(
    nextType = moduleType(),
    nextPage = modulePage(),
  ) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    setErrorMessage("");

    try {
      if (nextType === "user") {
        const payload = await searchModerationUsers(currentSession, "", {
          page: nextPage,
          limit: moduleLimit,
          sortBy: "username",
          sortDirection: "asc",
        });

        setModuleList(
          payload.items.map((entry) => ({
            id: entry.id,
            type: "user",
            title: entry.username
              ? `${entry.username}${entry.discriminator ? `#${entry.discriminator}` : ""}`
              : entry.id,
            subtitle: entry.displayName || entry.id,
          })),
        );
        setModuleTotal(payload.total);
        return;
      }

      if (nextType === "server") {
        const payload = await searchModerationServers(currentSession, "", {
          page: nextPage,
          limit: moduleLimit,
          sortBy: "name",
          sortDirection: "asc",
        });

        setModuleList(
          payload.items.map((entry) => ({
            id: entry.id,
            type: "server",
            title: entry.name,
            subtitle: entry.description || entry.id,
          })),
        );
        setModuleTotal(payload.total);
        return;
      }

      const payload = await searchModerationImages(currentSession, "", {
        page: nextPage,
        limit: moduleLimit,
        sortBy: "createdAt",
        sortDirection: "desc",
      });

      setModuleList(
        payload.items.map((entry) => ({
          id: entry.id,
          type: "image",
          title: entry.filename,
          subtitle: entry.contentType || entry.id,
        })),
      );
      setModuleTotal(payload.total);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load module listing",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveUserProfilePatch(patch: ModerationUserProfilePatch) {
    const currentSession = session();
    const userId = targetId().trim();
    if (!currentSession || !userId) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await updateModerationUserProfile(
        currentSession,
        userId,
        patch,
      );
      setInspectedUser(payload.item);
      setUserBadgeBitfield(
        typeof payload.item.badges === "number" ? payload.item.badges : 0,
      );
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update user moderation profile",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveServerProfilePatch(patch: ModerationServerProfilePatch) {
    const currentSession = session();
    const serverId = targetId().trim();
    if (!currentSession || !serverId) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await updateModerationServerProfile(
        currentSession,
        serverId,
        patch,
      );
      setInspectedServer(payload.item);
      setServerName(payload.item.name ?? "");
      setServerDescription(payload.item.description ?? "");
      setServerBadgeBitfield(
        typeof payload.item.flags === "number" ? payload.item.flags : 0,
      );
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update server moderation profile",
      );
    } finally {
      setLoading(false);
    }
  }

  async function applyInspectorAction(nextAction: ActionType) {
    const userId = targetId().trim();
    if (!userId) {
      setErrorMessage("No user selected for moderation action");
      return;
    }

    setActionType(nextAction);
    setActionReason(
      (current) => current || `Applied ${nextAction} from user inspector`,
    );
    setTargetType("user");
    await applyAction();
    await loadUserInspector(userId);
  }

  async function applyInspectorActionWithPreset(
    nextAction: ActionType,
    presetReason: string,
  ) {
    setActionReason(presetReason);
    await applyInspectorAction(nextAction);
  }

  async function confirmAndApplyProfilePatch(
    patch: ModerationUserProfilePatch,
    label: string,
  ) {
    const ok =
      typeof globalThis.confirm === "function"
        ? globalThis.confirm(
            `Confirm ${label}? This cannot be automatically undone.`,
          )
        : true;

    if (!ok) {
      return;
    }

    await saveUserProfilePatch(patch);
  }

  async function confirmAndApplyServerProfilePatch(
    patch: ModerationServerProfilePatch,
    label: string,
  ) {
    const ok =
      typeof globalThis.confirm === "function"
        ? globalThis.confirm(
            `Confirm ${label}? This cannot be automatically undone.`,
          )
        : true;

    if (!ok) {
      return;
    }

    await saveServerProfilePatch(patch);
  }

  function toggleUserBadgeBit(value: number) {
    setUserBadgeBitfield((current) =>
      current & value ? current & ~value : current | value,
    );
  }

  function toggleServerBadgeBit(value: number) {
    setServerBadgeBitfield((current) =>
      current & value ? current & ~value : current | value,
    );
  }

  async function submitModeratorComment() {
    const currentSession = session();
    const userId = targetId().trim();
    const body = newCommentBody().trim();
    if (!currentSession || !userId || !body) {
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      await createModerationUserComment(currentSession, userId, body, {
        attachments: parseCommentAttachmentInput(newCommentAttachments()),
        embeds: parseCommentEmbedInput(newCommentEmbeds()),
      });
      setNewCommentBody("");
      setNewCommentAttachments("");
      setNewCommentEmbeds("");
      const payload = await fetchModerationUserComments(
        currentSession,
        userId,
        100,
      );
      setUserComments(payload.items);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to post moderator comment",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitServerModeratorComment() {
    const currentSession = session();
    const serverId = targetId().trim();
    const body = newServerCommentBody().trim();
    if (!currentSession || !serverId || !body) {
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      await createModerationServerComment(currentSession, serverId, body, {
        attachments: parseCommentAttachmentInput(newServerCommentAttachments()),
        embeds: parseCommentEmbedInput(newServerCommentEmbeds()),
      });
      setNewServerCommentBody("");
      setNewServerCommentAttachments("");
      setNewServerCommentEmbeds("");
      const payload = await fetchModerationServerComments(
        currentSession,
        serverId,
        100,
      );
      setServerComments(payload.items);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to post server moderator comment",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitImageModeratorComment() {
    const currentSession = session();
    const imageId = targetId().trim();
    const body = newImageCommentBody().trim();
    if (!currentSession || !imageId || !body) {
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      await createModerationImageComment(currentSession, imageId, body, {
        attachments: parseCommentAttachmentInput(newImageCommentAttachments()),
        embeds: parseCommentEmbedInput(newImageCommentEmbeds()),
      });
      setNewImageCommentBody("");
      setNewImageCommentAttachments("");
      setNewImageCommentEmbeds("");
      const payload = await fetchModerationImageComments(
        currentSession,
        imageId,
        100,
      );
      setImageComments(payload.items);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to post image moderator comment",
      );
    } finally {
      setLoading(false);
    }
  }

  async function applyServerInspectorAction(nextAction: ActionType) {
    const serverId = targetId().trim();
    if (!serverId) {
      setErrorMessage("No server selected for moderation action");
      return;
    }

    setActionType(nextAction);
    setActionReason(
      (current) => current || `Applied ${nextAction} from server inspector`,
    );
    setTargetType("server");
    await applyAction();
    await loadServerInspector(serverId);
  }

  async function applyServerInspectorActionWithPreset(
    nextAction: ActionType,
    presetReason: string,
  ) {
    setActionReason(presetReason);
    await applyServerInspectorAction(nextAction);
  }

  async function applyImageInspectorAction(nextAction: ActionType) {
    const imageId = targetId().trim();
    if (!imageId) {
      setErrorMessage("No image selected for moderation action");
      return;
    }

    setActionType(nextAction);
    setActionReason(
      (current) => current || `Applied ${nextAction} from image inspector`,
    );
    setTargetType("image");
    await applyAction();
    await loadImageInspector(imageId);
  }

  async function createReportFromTarget() {
    const currentSession = session();
    if (!currentSession) return;

    const cleanedTargetId = targetId().trim();
    if (!cleanedTargetId) {
      setErrorMessage("Target ID is required to create a report");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await createModerationReport(currentSession, {
        targetType: targetType(),
        targetId: cleanedTargetId,
        reportReason: newReportReason().trim() || undefined,
        additionalContext: newReportContext().trim() || undefined,
        autoCreateCase: true,
      });

      setNewReportReason("");
      setNewReportContext("");
      await refresh();
      setStage("cases");
      if (payload.item?.id) {
        await loadReportDetails(payload.item.id);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create report",
      );
    } finally {
      setLoading(false);
    }
  }

  async function changeReportStatus(
    reportId: string,
    status: CaseStatus,
    note?: string,
  ) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const payload = await updateModerationReportStatus(
        currentSession,
        reportId,
        status,
        note,
      );
      setSelectedReport(payload.item);
      setReportStatusNote("");
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update report",
      );
    } finally {
      setLoading(false);
    }
  }

  async function runSearch() {
    const currentSession = session();
    const q = searchQuery().trim();

    if (!currentSession || !q) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      if (searchType() === "user") {
        const payload = await searchModerationUsers(currentSession, q, {
          limit: 24,
        });
        setSearchResults(
          payload.items.map(
            (entry: ModerationUserSearchResult): SearchResult => ({
              id: entry.id,
              type: "user",
              title: entry.username
                ? `${entry.username}${entry.discriminator ? `#${entry.discriminator}` : ""}`
                : entry.id,
              subtitle: entry.email || entry.id,
            }),
          ),
        );
        return;
      }

      if (searchType() === "server") {
        const payload = await searchModerationServers(currentSession, q, {
          limit: 24,
        });
        setSearchResults(
          payload.items.map(
            (entry: ModerationServerSearchResult): SearchResult => ({
              id: entry.id,
              type: "server",
              title: entry.name,
              subtitle: entry.id,
            }),
          ),
        );
        return;
      }

      const payload = await searchModerationImages(currentSession, q, {
        limit: 24,
      });
      setSearchResults(
        payload.items.map(
          (entry: ModerationImageSearchResult): SearchResult => ({
            id: entry.id,
            type: "image",
            title: entry.filename,
            subtitle: entry.url || entry.id,
          }),
        ),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function applyAction() {
    const currentSession = session();
    if (!currentSession) return;

    const cleanedTargetId = targetId().trim();
    const cleanedReason = actionReason().trim();

    if (!cleanedTargetId || !cleanedReason) {
      setErrorMessage("Target ID and reason are required");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      const selected = selectedReport();
      const selectedCaseId =
        selected &&
        selected.content.type === targetType() &&
        selected.content.id === cleanedTargetId
          ? (selected.caseId ?? selected.caseItem?.id)
          : undefined;

      await applyModerationAction(currentSession, {
        actionType: actionType(),
        targetType: targetType(),
        targetId: cleanedTargetId,
        reason: cleanedReason,
        evidence: actionEvidence().trim() || undefined,
        caseId: selectedCaseId,
      });

      setActionReason("");
      setActionEvidence("");
      await refresh();
      setStage("cases");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to apply action",
      );
    } finally {
      setLoading(false);
    }
  }

  async function changeCaseStatus(caseId: string, status: CaseStatus) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    setErrorMessage("");

    try {
      await updateModerationCaseStatus(currentSession, caseId, status);
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update case",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveModerator() {
    const currentSession = session();
    const userId = moderatorUserId().trim();
    if (!currentSession || !userId) return;

    setLoading(true);
    setErrorMessage("");

    try {
      await upsertModerator(currentSession, {
        userId,
        role: moderatorRole(),
      });
      setModeratorUserId("");
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save staff role",
      );
    } finally {
      setLoading(false);
    }
  }

  async function removeModeratorEntry(userId: string) {
    const currentSession = session();
    if (!currentSession) return;

    setLoading(true);
    setErrorMessage("");

    try {
      await removeModerator(currentSession, userId);
      await refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to remove staff role",
      );
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    if (session()) {
      void refresh();
    }
  });

  createEffect(() => {
    if (stage() === "module" && session()) {
      void loadModuleListing(moduleType(), modulePage());
    }
  });

  return (
    <Surface>
      <Hero>
        <Column gap="none">
          <Headline>Trust and Safety Dashboard</Headline>
          <Subline>
            Review reports faster, coordinate moderator actions, and keep case
            workflows moving from one central workspace.
          </Subline>
        </Column>

        <HeroActions>
          <PrimaryButton
            type="button"
            data-tone="ghost"
            onClick={() => navigate("/app")}
          >
            Back to App
          </PrimaryButton>
          <PrimaryButton
            type="button"
            data-tone="primary"
            disabled={loading()}
            onClick={() => void refresh()}
          >
            Refresh Data
          </PrimaryButton>
        </HeroActions>
      </Hero>

      <Show when={errorMessage()}>
        <Failure>{errorMessage()}</Failure>
      </Show>

      <Show
        when={session()}
        fallback={<Notice>Login required for moderation tools.</Notice>}
      >
        <Show
          when={canViewPanel()}
          fallback={<Notice>You do not have moderation scope.</Notice>}
        >
          <KpiRow>
            <KpiCard>
              <KpiTitle>Active Cases</KpiTitle>
              <KpiNumber>
                {caseTotals().open + caseTotals().investigating}
              </KpiNumber>
              <KpiHint>{caseTotals().total} total tracked</KpiHint>
            </KpiCard>
            <KpiCard>
              <KpiTitle>Report Queue</KpiTitle>
              <KpiNumber>
                {reportTotals().open + reportTotals().investigating}
              </KpiNumber>
              <KpiHint>{reportTotals().total} reports overall</KpiHint>
            </KpiCard>
            <KpiCard>
              <KpiTitle>Resolved Reports</KpiTitle>
              <KpiNumber>{reportTotals().resolved}</KpiNumber>
              <KpiHint>Closed out by moderators</KpiHint>
            </KpiCard>
            <KpiCard>
              <KpiTitle>Moderator Team</KpiTitle>
              <KpiNumber>{moderators().length}</KpiNumber>
              <KpiHint>Staff members with panel access</KpiHint>
            </KpiCard>
          </KpiRow>

          <Layout>
            <Rail>
              <RailBrand>
                <BrandTitle>Content Moderation</BrandTitle>
                <BrandSubline>
                  Reports, cases, actions, and team management
                </BrandSubline>
              </RailBrand>

              <RailHeader>Modules</RailHeader>
              <For each={STAGES}>
                {(entry) => (
                  <RailButton
                    type="button"
                    data-active={stage() === entry.key}
                    onClick={() => setStage(entry.key)}
                  >
                    {entry.label}
                  </RailButton>
                )}
              </For>

              <RailHeader>Quick Snapshot</RailHeader>
              <MetricTile>
                <MetricLabel>Total Cases</MetricLabel>
                <MetricValue>{caseTotals().total}</MetricValue>
              </MetricTile>
              <MetricTile>
                <MetricLabel>Open + Review</MetricLabel>
                <MetricValue>
                  {caseTotals().open + caseTotals().investigating}
                </MetricValue>
              </MetricTile>
              <MetricTile>
                <MetricLabel>Staff</MetricLabel>
                <MetricValue>{moderators().length}</MetricValue>
              </MetricTile>
            </Rail>

            <WorkArea>
              <Show when={stage() === "intel"}>
                <Pane>
                  <PaneTitle>Workspace Modules</PaneTitle>
                  <ModuleGrid>
                    <ModuleCard>
                      <Text>
                        <strong>Queue Health</strong>
                      </Text>
                      <Muted>
                        Monitor open queues and jump into reports and cases.
                      </Muted>
                      <PrimaryButton
                        type="button"
                        data-tone="ghost"
                        onClick={() => setStage("cases")}
                      >
                        Open Queue
                      </PrimaryButton>
                    </ModuleCard>

                    <ModuleCard>
                      <Text>
                        <strong>Take Action</strong>
                      </Text>
                      <Muted>
                        Search entities and apply moderation decisions quickly.
                      </Muted>
                      <PrimaryButton
                        type="button"
                        data-tone="ghost"
                        onClick={() => setStage("cases")}
                      >
                        Open Cases & Reports
                      </PrimaryButton>
                    </ModuleCard>

                    <ModuleCard>
                      <Text>
                        <strong>Team Operations</strong>
                      </Text>
                      <Muted>
                        Grant permissions and keep moderator coverage healthy.
                      </Muted>
                      <PrimaryButton
                        type="button"
                        data-tone="ghost"
                        onClick={() => setStage("staff")}
                      >
                        Manage Team
                      </PrimaryButton>
                    </ModuleCard>
                  </ModuleGrid>
                </Pane>

                <Pane>
                  <PaneTitle>Find Users, Servers, and Media</PaneTitle>
                  <Toolbar>
                    <select
                      value={searchType()}
                      onInput={(event) =>
                        setSearchType(event.currentTarget.value as SearchType)
                      }
                    >
                      <option value="user">User</option>
                      <option value="server">Server</option>
                      <option value="image">Image</option>
                    </select>
                    <input
                      value={searchQuery()}
                      placeholder="id, name, email, filename"
                      onInput={(event) =>
                        setSearchQuery(event.currentTarget.value)
                      }
                    />
                    <PrimaryButton
                      type="button"
                      data-tone="primary"
                      disabled={loading()}
                      onClick={() => void runSearch()}
                    >
                      Search
                    </PrimaryButton>
                  </Toolbar>

                  <ResultGrid>
                    <Show
                      when={searchResults().length > 0}
                      fallback={<Muted>No search results yet.</Muted>}
                    >
                      <For each={searchResults()}>
                        {(entry) => (
                          <ResultCard>
                            <Column gap="none">
                              <Text>
                                <strong>{entry.title}</strong>
                              </Text>
                              <Muted>{entry.subtitle}</Muted>
                            </Column>
                            <InlineButtons>
                              <PrimaryButton
                                type="button"
                                data-tone="ghost"
                                onClick={() => {
                                  if (entry.type === "user") {
                                    void loadUserInspector(entry.id);
                                    return;
                                  }

                                  if (entry.type === "server") {
                                    void loadServerInspector(entry.id);
                                    return;
                                  }

                                  if (entry.type === "image") {
                                    void loadImageInspector(entry.id);
                                    return;
                                  }

                                  navigate(
                                    `/moderation/${entry.type}/${entry.id}`,
                                  );
                                }}
                              >
                                Open
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>
                </Pane>

                <Pane>
                  <PaneTitle>Shortcuts</PaneTitle>
                  <QuickActionsGrid>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      onClick={() => {
                        setSearchType("user");
                        setStage("intel");
                      }}
                    >
                      User Lookup
                    </PrimaryButton>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      onClick={() => {
                        if (targetType() === "user" && targetId().trim()) {
                          void loadUserInspector(targetId().trim());
                        } else if (
                          targetType() === "server" &&
                          targetId().trim()
                        ) {
                          void loadServerInspector(targetId().trim());
                        } else if (
                          targetType() === "image" &&
                          targetId().trim()
                        ) {
                          void loadImageInspector(targetId().trim());
                        } else {
                          setStage("cases");
                        }
                      }}
                    >
                      New Action
                    </PrimaryButton>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      onClick={() => setStage("cases")}
                    >
                      Case Board
                    </PrimaryButton>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      onClick={() => setStage("staff")}
                    >
                      Team Access
                    </PrimaryButton>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      onClick={() => void refresh()}
                    >
                      Refresh Workspace
                    </PrimaryButton>
                  </QuickActionsGrid>

                  <PaneTitle style={{ "margin-top": "8px" }}>
                    Latest Cases
                  </PaneTitle>
                  <ResultGrid>
                    <Show
                      when={latestCases().length > 0}
                      fallback={<Muted>No cases loaded.</Muted>}
                    >
                      <For each={latestCases()}>
                        {(entry) => (
                          <ResultCard>
                            {(() => {
                              const summary = entry.targetSummary
                                ? {
                                    type: entry.targetSummary.type,
                                    id: entry.targetSummary.id,
                                    title: entry.targetSummary.title,
                                    subtitle: entry.targetSummary.subtitle,
                                    avatar: entry.targetSummary.avatar,
                                    iconURL: entry.targetSummary.iconURL,
                                    imageURL: entry.targetSummary.imageURL,
                                  }
                                : {
                                    type: entry.target.type,
                                    id: entry.target.id,
                                    title: entry.target.id,
                                  };
                              const media = getSummaryPrimaryMedia(summary);

                              return (
                                <CommentIdentityRow>
                                  <Show when={media}>
                                    {(src) => (
                                      <CommentIdentityImage
                                        src={src()}
                                        alt={summary.title}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                      />
                                    )}
                                  </Show>
                                  <Column gap="none">
                                    <Text>
                                      <strong>{summary.title}</strong>
                                    </Text>
                                    <Muted>
                                      {summary.subtitle ||
                                        `${summary.type}:${summary.id}`}
                                    </Muted>
                                  </Column>
                                </CommentIdentityRow>
                              );
                            })()}
                            <Muted>{entry.reason}</Muted>
                            <Tag data-state={entry.status}>{entry.status}</Tag>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>
                </Pane>
              </Show>

              <Show when={stage() === "module"}>
                <Pane>
                  <PaneTitle>Full List</PaneTitle>
                  <Toolbar>
                    <select
                      value={moduleType()}
                      onInput={(event) => {
                        const nextType = event.currentTarget.value;
                        setModuleType(nextType as ModuleType);
                        setModulePage(1);
                        void loadModuleListing(nextType as ModuleType, 1);
                      }}
                    >
                      <option value="user">Users</option>
                      <option value="server">Servers</option>
                      <option value="image">Images</option>
                    </select>
                    <PrimaryButton
                      type="button"
                      data-tone="primary"
                      disabled={loading()}
                      onClick={() => void loadModuleListing()}
                    >
                      Refresh List
                    </PrimaryButton>
                  </Toolbar>

                  <Muted>
                    Browsing {moduleType()} entries ({moduleTotal()} total).
                  </Muted>

                  <ResultGrid>
                    <Show
                      when={moduleList().length > 0}
                      fallback={<Muted>No entries found.</Muted>}
                    >
                      <For each={moduleList()}>
                        {(entry) => (
                          <ResultCard>
                            <Column gap="none">
                              <Text>
                                <strong>{entry.title}</strong>
                              </Text>
                              <Muted>{entry.subtitle}</Muted>
                              <Muted>ID: {entry.id}</Muted>
                            </Column>
                            <InlineButtons>
                              <PrimaryButton
                                type="button"
                                data-tone="ghost"
                                onClick={() => {
                                  if (entry.type === "user") {
                                    void loadUserInspector(entry.id);
                                    return;
                                  }

                                  if (entry.type === "server") {
                                    void loadServerInspector(entry.id);
                                    return;
                                  }

                                  void loadImageInspector(entry.id);
                                }}
                              >
                                Open
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>

                  <InlineButtons>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      disabled={loading() || modulePage() <= 1}
                      onClick={() => {
                        const nextPage = Math.max(1, modulePage() - 1);
                        setModulePage(nextPage);
                        void loadModuleListing(moduleType(), nextPage);
                      }}
                    >
                      Previous Page
                    </PrimaryButton>
                    <PrimaryButton
                      type="button"
                      data-tone="ghost"
                      disabled={
                        loading() || modulePage() * moduleLimit >= moduleTotal()
                      }
                      onClick={() => {
                        const nextPage = modulePage() + 1;
                        setModulePage(nextPage);
                        void loadModuleListing(moduleType(), nextPage);
                      }}
                    >
                      Next Page
                    </PrimaryButton>
                  </InlineButtons>
                </Pane>
              </Show>

              <Show when={stage() === "inspector"}>
                <Pane>
                  <PaneTitle>User Inspector</PaneTitle>
                  <Show
                    when={inspectedUser()}
                    fallback={
                      <Muted>
                        Select a user from search, actions, or cases to open the
                        inspector.
                      </Muted>
                    }
                  >
                    {(user) => (
                      <ResultGrid>
                        <ResultCard>
                          <Text>
                            <strong>
                              {user().username || "Unknown User"}
                              {user().discriminator
                                ? `#${user().discriminator}`
                                : ""}
                            </strong>
                          </Text>
                          <Muted>ID: {user().id}</Muted>
                          <Muted>
                            Display Name: {user().displayName || "(none)"}
                          </Muted>
                          <Muted>
                            Bio: {String(user().profile?.content || "(none)")}
                          </Muted>
                          <Muted>
                            Banner:{" "}
                            {user().profile?.background ? "present" : "none"}
                          </Muted>
                          <Muted>
                            Avatar: {user().avatar ? "present" : "none"}
                          </Muted>
                          <MediaGrid>
                            <MediaTile>
                              <MediaLabel>User Avatar</MediaLabel>
                              <Show
                                when={toMediaUrl("avatars", user().avatar)}
                                fallback={<Muted>No avatar image</Muted>}
                              >
                                {(src) => (
                                  <MediaImage
                                    src={src()}
                                    alt={`Avatar of ${user().username || user().id}`}
                                    data-shape="round"
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                              </Show>
                            </MediaTile>
                            <MediaTile>
                              <MediaLabel>User Banner</MediaLabel>
                              <Show
                                when={toMediaUrl(
                                  "backgrounds",
                                  user().profile?.background,
                                )}
                                fallback={<Muted>No banner image</Muted>}
                              >
                                {(src) => (
                                  <MediaImage
                                    src={src()}
                                    alt={`Banner of ${user().username || user().id}`}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                              </Show>
                            </MediaTile>
                          </MediaGrid>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Quick Moderation Actions</PaneTitle>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="warning"
                              disabled={loading()}
                              onClick={() => void applyInspectorAction("warn")}
                            >
                              Warn User
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="warning"
                              disabled={loading()}
                              onClick={() =>
                                void applyInspectorAction("strike")
                              }
                            >
                              Strike User
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="danger"
                              disabled={loading()}
                              onClick={() =>
                                void applyInspectorAction("timeout")
                              }
                            >
                              Suspend User
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="danger"
                              disabled={loading()}
                              onClick={() => void applyInspectorAction("ban")}
                            >
                              Ban User
                            </PrimaryButton>
                          </InlineButtons>

                          <Muted>
                            Preset reasons help moderators apply consistent,
                            audit-friendly actions.
                          </Muted>
                          <PresetGrid>
                            <PresetColumn>
                              <PresetHeading>Warn Presets</PresetHeading>
                              <For each={INSPECTOR_REASON_PRESETS.warn}>
                                {(preset) => (
                                  <PrimaryButton
                                    type="button"
                                    data-tone="ghost"
                                    disabled={loading()}
                                    onClick={() =>
                                      void applyInspectorActionWithPreset(
                                        "warn",
                                        preset,
                                      )
                                    }
                                  >
                                    {preset}
                                  </PrimaryButton>
                                )}
                              </For>
                            </PresetColumn>
                            <PresetColumn>
                              <PresetHeading>Strike Presets</PresetHeading>
                              <For each={INSPECTOR_REASON_PRESETS.strike}>
                                {(preset) => (
                                  <PrimaryButton
                                    type="button"
                                    data-tone="ghost"
                                    disabled={loading()}
                                    onClick={() =>
                                      void applyInspectorActionWithPreset(
                                        "strike",
                                        preset,
                                      )
                                    }
                                  >
                                    {preset}
                                  </PrimaryButton>
                                )}
                              </For>
                            </PresetColumn>
                            <PresetColumn>
                              <PresetHeading>Suspend Presets</PresetHeading>
                              <For each={INSPECTOR_REASON_PRESETS.timeout}>
                                {(preset) => (
                                  <PrimaryButton
                                    type="button"
                                    data-tone="ghost"
                                    disabled={loading()}
                                    onClick={() =>
                                      void applyInspectorActionWithPreset(
                                        "timeout",
                                        preset,
                                      )
                                    }
                                  >
                                    {preset}
                                  </PrimaryButton>
                                )}
                              </For>
                            </PresetColumn>
                            <PresetColumn>
                              <PresetHeading>Ban Presets</PresetHeading>
                              <For each={INSPECTOR_REASON_PRESETS.ban}>
                                {(preset) => (
                                  <PrimaryButton
                                    type="button"
                                    data-tone="ghost"
                                    disabled={loading()}
                                    onClick={() =>
                                      void applyInspectorActionWithPreset(
                                        "ban",
                                        preset,
                                      )
                                    }
                                  >
                                    {preset}
                                  </PrimaryButton>
                                )}
                              </For>
                            </PresetColumn>
                          </PresetGrid>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Profile Cleanup</PaneTitle>
                          <FormGrid>
                            <label>
                              Username
                              <input
                                value={profileUsername()}
                                onInput={(event) =>
                                  setProfileUsername(event.currentTarget.value)
                                }
                              />
                            </label>
                            <label>
                              Display Name
                              <input
                                value={profileDisplayName()}
                                onInput={(event) =>
                                  setProfileDisplayName(
                                    event.currentTarget.value,
                                  )
                                }
                              />
                            </label>
                            <label>
                              Bio
                              <input
                                value={profileBio()}
                                onInput={(event) =>
                                  setProfileBio(event.currentTarget.value)
                                }
                              />
                            </label>
                          </FormGrid>

                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={loading()}
                              onClick={() =>
                                void saveUserProfilePatch({
                                  username:
                                    profileUsername().trim() || undefined,
                                  displayName:
                                    profileDisplayName().trim() || undefined,
                                  bio: profileBio().trim() || undefined,
                                })
                              }
                            >
                              Save Profile Changes
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyProfilePatch(
                                  {
                                    removeDisplayName: true,
                                  },
                                  "removing display name",
                                )
                              }
                            >
                              Remove Display Name
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyProfilePatch(
                                  {
                                    removeAvatar: true,
                                  },
                                  "removing avatar",
                                )
                              }
                            >
                              Remove Avatar
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyProfilePatch(
                                  {
                                    removeBio: true,
                                  },
                                  "removing bio",
                                )
                              }
                            >
                              Remove Bio
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyProfilePatch(
                                  {
                                    removeBanner: true,
                                  },
                                  "removing banner",
                                )
                              }
                            >
                              Remove Banner
                            </PrimaryButton>
                          </InlineButtons>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>User Badge Assigner</PaneTitle>
                          <Muted>
                            Toggle badge bits and save the combined bitfield.
                          </Muted>
                          <PresetGrid>
                            <For each={USER_BADGE_BITS}>
                              {(badge) => (
                                <label>
                                  <CheckboxRow>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(
                                        userBadgeBitfield() & badge.value,
                                      )}
                                      onInput={() =>
                                        toggleUserBadgeBit(badge.value)
                                      }
                                    />
                                    <span>{badge.label}</span>
                                    <Muted>bit {badge.value}</Muted>
                                  </CheckboxRow>
                                </label>
                              )}
                            </For>
                          </PresetGrid>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={loading()}
                              onClick={() =>
                                void saveUserProfilePatch({
                                  badges: userBadgeBitfield(),
                                })
                              }
                            >
                              Save User Badges
                            </PrimaryButton>
                            <Muted>Current value: {userBadgeBitfield()}</Muted>
                          </InlineButtons>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Action Timeline</PaneTitle>
                          <Show
                            when={inspectorActions().length > 0}
                            fallback={
                              <Muted>
                                No moderation actions recorded for this user
                                yet.
                              </Muted>
                            }
                          >
                            <Timeline>
                              <For each={inspectorActions()}>
                                {(entry) => (
                                  <TimelineItem>
                                    <TimelineTitle>
                                      {entry.actionType} - {entry.reason}
                                    </TimelineTitle>
                                    <TimelineMeta>
                                      by {entry.performedBy || "unknown"} |{" "}
                                      {new Date(
                                        entry.createdAt,
                                      ).toLocaleString()}
                                    </TimelineMeta>
                                  </TimelineItem>
                                )}
                              </For>
                            </Timeline>
                          </Show>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Moderator Discussion</PaneTitle>
                          <Muted>
                            Internal notes for moderators to discuss context and
                            decisions on this user.
                          </Muted>
                          <label>
                            Add Comment
                            <textarea
                              value={newCommentBody()}
                              placeholder="Add context, follow-up tasks, or moderation reasoning"
                              onInput={(event) =>
                                setNewCommentBody(event.currentTarget.value)
                              }
                            />
                          </label>
                          <label>
                            Attachment URLs (one per line)
                            <textarea
                              value={newCommentAttachments()}
                              placeholder="https://..."
                              onInput={(event) =>
                                setNewCommentAttachments(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Embed URLs (one per line)
                            <textarea
                              value={newCommentEmbeds()}
                              placeholder="https://..."
                              onInput={(event) =>
                                setNewCommentEmbeds(event.currentTarget.value)
                              }
                            />
                          </label>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={loading() || !newCommentBody().trim()}
                              onClick={() => void submitModeratorComment()}
                            >
                              Post Comment
                            </PrimaryButton>
                          </InlineButtons>
                          <Show
                            when={userComments().length > 0}
                            fallback={<Muted>No moderator comments yet.</Muted>}
                          >
                            {renderDiscussionTimeline(userComments())}
                          </Show>
                        </ResultCard>
                      </ResultGrid>
                    )}
                  </Show>
                </Pane>
              </Show>

              <Show when={stage() === "serverInspector"}>
                <Pane>
                  <PaneTitle>Server Inspector</PaneTitle>
                  <Show
                    when={inspectedServer()}
                    fallback={
                      <Muted>
                        Select a server from search, actions, or cases to open
                        the inspector.
                      </Muted>
                    }
                  >
                    {(server) => (
                      <ResultGrid>
                        <ResultCard>
                          <Text>
                            <strong>{server().name || "Unknown Server"}</strong>
                          </Text>
                          <Muted>ID: {server().id}</Muted>
                          <Muted>Owner: {server().ownerId || "unknown"}</Muted>
                          <Muted>
                            Description: {server().description || "(none)"}
                          </Muted>
                          <Muted>
                            Banner: {server().banner ? "present" : "none"}
                          </Muted>
                          <Muted>
                            Channels: {server().channelCount ?? "unknown"}
                          </Muted>
                          <MediaGrid>
                            <MediaTile>
                              <MediaLabel>Server Icon</MediaLabel>
                              <Show
                                when={toMediaUrl("icons", server().iconURL)}
                                fallback={<Muted>No server icon</Muted>}
                              >
                                {(src) => (
                                  <MediaImage
                                    src={src()}
                                    alt={`Icon of ${server().name || server().id}`}
                                    data-shape="round"
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                              </Show>
                            </MediaTile>
                            <MediaTile>
                              <MediaLabel>Server Banner</MediaLabel>
                              <Show
                                when={toMediaUrl("banners", server().banner)}
                                fallback={<Muted>No server banner</Muted>}
                              >
                                {(src) => (
                                  <MediaImage
                                    src={src()}
                                    alt={`Banner of ${server().name || server().id}`}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                              </Show>
                            </MediaTile>
                          </MediaGrid>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Quick Moderation Actions</PaneTitle>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="warning"
                              disabled={loading()}
                              onClick={() =>
                                void saveServerProfilePatch({
                                  moderationDisabled:
                                    !server().moderationDisabled,
                                })
                              }
                            >
                              {server().moderationDisabled
                                ? "Enable Server"
                                : "Disable Server"}
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="danger"
                              disabled={loading()}
                              onClick={() =>
                                void applyServerInspectorAction("delete_server")
                              }
                            >
                              Delete Server
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void applyServerInspectorAction("note")
                              }
                            >
                              Add Action Note
                            </PrimaryButton>
                          </InlineButtons>

                          <Muted>
                            Preset reasons help moderators apply consistent,
                            audit-friendly actions.
                          </Muted>
                          <PresetGrid>
                            <PresetColumn>
                              <PresetHeading>Disable Presets</PresetHeading>
                              <For
                                each={
                                  SERVER_INSPECTOR_REASON_PRESETS.disable_server
                                }
                              >
                                {(preset) => (
                                  <PrimaryButton
                                    type="button"
                                    data-tone="ghost"
                                    disabled={loading()}
                                    onClick={() =>
                                      void applyServerInspectorActionWithPreset(
                                        "disable_server",
                                        preset,
                                      )
                                    }
                                  >
                                    {preset}
                                  </PrimaryButton>
                                )}
                              </For>
                            </PresetColumn>
                            <PresetColumn>
                              <PresetHeading>Delete Presets</PresetHeading>
                              <For
                                each={
                                  SERVER_INSPECTOR_REASON_PRESETS.delete_server
                                }
                              >
                                {(preset) => (
                                  <PrimaryButton
                                    type="button"
                                    data-tone="ghost"
                                    disabled={loading()}
                                    onClick={() =>
                                      void applyServerInspectorActionWithPreset(
                                        "delete_server",
                                        preset,
                                      )
                                    }
                                  >
                                    {preset}
                                  </PrimaryButton>
                                )}
                              </For>
                            </PresetColumn>
                          </PresetGrid>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Server Badges</PaneTitle>
                          <Muted>
                            Set server badge flags using the bitfield values.
                          </Muted>
                          <PresetGrid>
                            <For each={SERVER_BADGE_BITS}>
                              {(badge) => (
                                <label>
                                  <CheckboxRow>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(
                                        serverBadgeBitfield() & badge.value,
                                      )}
                                      onInput={() =>
                                        toggleServerBadgeBit(badge.value)
                                      }
                                    />
                                    <span>{badge.label}</span>
                                    <Muted>bit {badge.value}</Muted>
                                  </CheckboxRow>
                                </label>
                              )}
                            </For>
                          </PresetGrid>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={loading()}
                              onClick={() =>
                                void saveServerProfilePatch({
                                  flags: serverBadgeBitfield(),
                                })
                              }
                            >
                              Save Server Badges
                            </PrimaryButton>
                            <Muted>
                              Current value: {serverBadgeBitfield()}
                            </Muted>
                          </InlineButtons>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Server Profile Cleanup</PaneTitle>
                          <FormGrid>
                            <label>
                              Name
                              <input
                                value={serverName()}
                                onInput={(event) =>
                                  setServerName(event.currentTarget.value)
                                }
                              />
                            </label>
                            <label>
                              Description
                              <input
                                value={serverDescription()}
                                onInput={(event) =>
                                  setServerDescription(
                                    event.currentTarget.value,
                                  )
                                }
                              />
                            </label>
                          </FormGrid>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={loading()}
                              onClick={() =>
                                void saveServerProfilePatch({
                                  name: serverName().trim() || undefined,
                                  description:
                                    serverDescription().trim() || undefined,
                                })
                              }
                            >
                              Save Server Profile
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyServerProfilePatch(
                                  { removeDescription: true },
                                  "removing server description",
                                )
                              }
                            >
                              Remove Description
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyServerProfilePatch(
                                  { removeIcon: true },
                                  "removing server icon",
                                )
                              }
                            >
                              Remove Icon
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void confirmAndApplyServerProfilePatch(
                                  { removeBanner: true },
                                  "removing server banner",
                                )
                              }
                            >
                              Remove Banner
                            </PrimaryButton>
                          </InlineButtons>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Action Timeline</PaneTitle>
                          <Show
                            when={serverInspectorActions().length > 0}
                            fallback={
                              <Muted>
                                No moderation actions recorded for this server
                                yet.
                              </Muted>
                            }
                          >
                            <Timeline>
                              <For each={serverInspectorActions()}>
                                {(entry) => (
                                  <TimelineItem>
                                    <TimelineTitle>
                                      {entry.actionType} - {entry.reason}
                                    </TimelineTitle>
                                    <TimelineMeta>
                                      by {entry.performedBy || "unknown"} |{" "}
                                      {new Date(
                                        entry.createdAt,
                                      ).toLocaleString()}
                                    </TimelineMeta>
                                  </TimelineItem>
                                )}
                              </For>
                            </Timeline>
                          </Show>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Moderator Discussion</PaneTitle>
                          <Muted>
                            Internal notes for moderators to discuss context and
                            decisions on this server.
                          </Muted>
                          <label>
                            Add Comment
                            <textarea
                              value={newServerCommentBody()}
                              placeholder="Add context, follow-up tasks, or moderation reasoning"
                              onInput={(event) =>
                                setNewServerCommentBody(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Attachment URLs (one per line)
                            <textarea
                              value={newServerCommentAttachments()}
                              placeholder="https://..."
                              onInput={(event) =>
                                setNewServerCommentAttachments(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Embed URLs (one per line)
                            <textarea
                              value={newServerCommentEmbeds()}
                              placeholder="https://..."
                              onInput={(event) =>
                                setNewServerCommentEmbeds(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={
                                loading() || !newServerCommentBody().trim()
                              }
                              onClick={() =>
                                void submitServerModeratorComment()
                              }
                            >
                              Post Comment
                            </PrimaryButton>
                          </InlineButtons>
                          <Show
                            when={serverComments().length > 0}
                            fallback={<Muted>No moderator comments yet.</Muted>}
                          >
                            {renderDiscussionTimeline(serverComments())}
                          </Show>
                        </ResultCard>
                      </ResultGrid>
                    )}
                  </Show>
                </Pane>
              </Show>

              <Show when={stage() === "imageInspector"}>
                <Pane>
                  <PaneTitle>Image Inspector</PaneTitle>
                  <Show
                    when={inspectedImage()}
                    fallback={
                      <Muted>
                        Select an image from search, module, actions, or cases
                        to open the inspector.
                      </Muted>
                    }
                  >
                    {(image) => (
                      <ResultGrid>
                        <ResultCard>
                          <Text>
                            <strong>
                              {image().filename || "Unknown Image"}
                            </strong>
                          </Text>
                          <Muted>ID: {image().id}</Muted>
                          <Muted>
                            Uploader: {image().uploaderId || "unknown"}
                          </Muted>
                          <Muted>
                            Content Type: {image().contentType || "unknown"}
                          </Muted>
                          <Muted>Size: {formatBytes(image().size)}</Muted>
                          <Muted>
                            Removed: {image().removed ? "yes" : "no"}
                          </Muted>
                          <MediaGrid>
                            <MediaTile>
                              <MediaLabel>Image Preview</MediaLabel>
                              <Show
                                when={toAttachmentMediaUrl(image().id)}
                                fallback={<Muted>No preview available</Muted>}
                              >
                                {(src) => (
                                  <MediaImage
                                    src={src()}
                                    alt={image().filename || image().id}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                              </Show>
                            </MediaTile>
                          </MediaGrid>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Quick Moderation Actions</PaneTitle>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="danger"
                              disabled={loading()}
                              onClick={() =>
                                void applyImageInspectorAction("delete_image")
                              }
                            >
                              Delete Image
                            </PrimaryButton>
                            <PrimaryButton
                              type="button"
                              data-tone="ghost"
                              disabled={loading()}
                              onClick={() =>
                                void applyImageInspectorAction("note")
                              }
                            >
                              Add Action Note
                            </PrimaryButton>
                          </InlineButtons>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Action Timeline</PaneTitle>
                          <Show
                            when={imageInspectorActions().length > 0}
                            fallback={
                              <Muted>
                                No moderation actions recorded for this image
                                yet.
                              </Muted>
                            }
                          >
                            <Timeline>
                              <For each={imageInspectorActions()}>
                                {(entry) => (
                                  <TimelineItem>
                                    <TimelineTitle>
                                      {entry.actionType} - {entry.reason}
                                    </TimelineTitle>
                                    <TimelineMeta>
                                      by {entry.performedBy || "unknown"} |{" "}
                                      {new Date(
                                        entry.createdAt,
                                      ).toLocaleString()}
                                    </TimelineMeta>
                                  </TimelineItem>
                                )}
                              </For>
                            </Timeline>
                          </Show>
                        </ResultCard>

                        <ResultCard>
                          <PaneTitle>Moderator Discussion</PaneTitle>
                          <Muted>
                            Internal notes for moderators to discuss this image
                            and related context.
                          </Muted>
                          <label>
                            Add Comment
                            <textarea
                              value={newImageCommentBody()}
                              placeholder="Add context, follow-up tasks, or moderation reasoning"
                              onInput={(event) =>
                                setNewImageCommentBody(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Attachment URLs (one per line)
                            <textarea
                              value={newImageCommentAttachments()}
                              placeholder="https://..."
                              onInput={(event) =>
                                setNewImageCommentAttachments(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            Embed URLs (one per line)
                            <textarea
                              value={newImageCommentEmbeds()}
                              placeholder="https://..."
                              onInput={(event) =>
                                setNewImageCommentEmbeds(
                                  event.currentTarget.value,
                                )
                              }
                            />
                          </label>
                          <InlineButtons>
                            <PrimaryButton
                              type="button"
                              data-tone="primary"
                              disabled={
                                loading() || !newImageCommentBody().trim()
                              }
                              onClick={() => void submitImageModeratorComment()}
                            >
                              Post Comment
                            </PrimaryButton>
                          </InlineButtons>
                          <Show
                            when={imageComments().length > 0}
                            fallback={<Muted>No moderator comments yet.</Muted>}
                          >
                            {renderDiscussionTimeline(imageComments())}
                          </Show>
                        </ResultCard>
                      </ResultGrid>
                    )}
                  </Show>
                </Pane>
              </Show>

              <Show when={stage() === "cases"}>
                <Pane>
                  <PaneTitle>Action Composer</PaneTitle>
                  <FormGrid>
                    <label>
                      Target Type
                      <select
                        value={targetType()}
                        onInput={(event) =>
                          setTargetType(event.currentTarget.value as TargetType)
                        }
                      >
                        <option value="user">user</option>
                        <option value="message">message</option>
                        <option value="server">server</option>
                        <option value="image">image</option>
                      </select>
                    </label>
                    <label>
                      Target ID
                      <input
                        value={targetId()}
                        onInput={(event) =>
                          setTargetId(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label>
                      Action
                      <select
                        value={actionType()}
                        onInput={(event) =>
                          setActionType(event.currentTarget.value as ActionType)
                        }
                      >
                        <For each={ACTION_TYPES}>
                          {(entry) => <option value={entry}>{entry}</option>}
                        </For>
                      </select>
                    </label>
                    <label>
                      Reason
                      <input
                        value={actionReason()}
                        onInput={(event) =>
                          setActionReason(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label>
                      Evidence
                      <input
                        value={actionEvidence()}
                        onInput={(event) =>
                          setActionEvidence(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label>
                      Report Reason
                      <input
                        value={newReportReason()}
                        placeholder="spam, harassment, impersonation"
                        onInput={(event) =>
                          setNewReportReason(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label>
                      Report Context
                      <input
                        value={newReportContext()}
                        placeholder="extra detail for triage"
                        onInput={(event) =>
                          setNewReportContext(event.currentTarget.value)
                        }
                      />
                    </label>
                    <PrimaryButton
                      type="button"
                      data-tone="primary"
                      disabled={loading()}
                      onClick={() => void applyAction()}
                    >
                      Apply Action
                    </PrimaryButton>
                    <PrimaryButton
                      type="button"
                      data-tone="warning"
                      disabled={loading()}
                      onClick={() => void createReportFromTarget()}
                    >
                      Create Report and Case
                    </PrimaryButton>
                  </FormGrid>
                </Pane>

                <Pane>
                  <PaneTitle>Recent Enforcement</PaneTitle>
                  <ResultGrid>
                    <Show
                      when={actions().length > 0}
                      fallback={<Muted>No actions yet.</Muted>}
                    >
                      <For each={actions()}>
                        {(entry) => (
                          <ResultCard>
                            <Text>
                              <strong>{entry.actionType}</strong> on{" "}
                              {entry.targetType}:{entry.targetId}
                            </Text>
                            <Muted>{entry.reason}</Muted>
                            <InlineButtons>
                              <PrimaryButton
                                type="button"
                                data-tone="ghost"
                                onClick={() => {
                                  if (entry.targetType === "user") {
                                    void loadUserInspector(entry.targetId);
                                    return;
                                  }

                                  if (entry.targetType === "server") {
                                    void loadServerInspector(entry.targetId);
                                    return;
                                  }

                                  if (entry.targetType === "image") {
                                    void loadImageInspector(entry.targetId);
                                    return;
                                  }

                                  navigate(
                                    `/moderation/${entry.targetType}/${entry.targetId}`,
                                  );
                                }}
                              >
                                Inspect
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>
                </Pane>
              </Show>

              <Show when={stage() === "cases"}>
                <Pane>
                  <PaneTitle>Report Queue</PaneTitle>
                  <ResultGrid>
                    <Show
                      when={activeReports().length > 0}
                      fallback={<Muted>No reports in queue.</Muted>}
                    >
                      <For each={activeReports()}>
                        {(entry) => (
                          <ResultCard>
                            {(() => {
                              const summary = getReportTargetSummary(entry);
                              const media = getSummaryPrimaryMedia(summary);

                              return (
                                <CommentIdentityRow>
                                  <Show when={media}>
                                    {(src) => (
                                      <CommentIdentityImage
                                        src={src()}
                                        alt={summary.title}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                      />
                                    )}
                                  </Show>
                                  <Column gap="none">
                                    <Text>
                                      <strong>{summary.title}</strong>
                                    </Text>
                                    <Muted>
                                      {summary.subtitle ||
                                        `${summary.type}:${summary.id}`}
                                    </Muted>
                                  </Column>
                                </CommentIdentityRow>
                              );
                            })()}
                            <Muted>
                              {entry.content.report_reason ||
                                "No reason provided"}
                            </Muted>
                            <Muted>
                              {entry.additional_context || "No context"}
                            </Muted>
                            <InlineButtons>
                              <Tag data-state={entry.status}>
                                {entry.status}
                              </Tag>
                              <PrimaryButton
                                type="button"
                                data-tone="ghost"
                                onClick={() => void loadReportDetails(entry.id)}
                              >
                                Details
                              </PrimaryButton>
                              <PrimaryButton
                                type="button"
                                data-tone="warning"
                                onClick={() =>
                                  void changeReportStatus(
                                    entry.id,
                                    "investigating",
                                  )
                                }
                              >
                                Review
                              </PrimaryButton>
                              <PrimaryButton
                                type="button"
                                data-tone="success"
                                onClick={() =>
                                  void changeReportStatus(entry.id, "resolved")
                                }
                              >
                                Resolve
                              </PrimaryButton>
                              <PrimaryButton
                                type="button"
                                data-tone="danger"
                                onClick={() =>
                                  void changeReportStatus(entry.id, "dismissed")
                                }
                              >
                                Dismiss
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>

                  <PaneTitle style={{ "margin-top": "6px" }}>
                    Resolved Reports
                  </PaneTitle>
                  <ResultGrid>
                    <Show
                      when={resolvedReports().length > 0}
                      fallback={<Muted>No resolved reports yet.</Muted>}
                    >
                      <For each={resolvedReports()}>
                        {(entry) => (
                          <ResultCard>
                            {(() => {
                              const summary = getReportTargetSummary(entry);
                              const media = getSummaryPrimaryMedia(summary);

                              return (
                                <CommentIdentityRow>
                                  <Show when={media}>
                                    {(src) => (
                                      <CommentIdentityImage
                                        src={src()}
                                        alt={summary.title}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                      />
                                    )}
                                  </Show>
                                  <Column gap="none">
                                    <Text>
                                      <strong>{summary.title}</strong>
                                    </Text>
                                    <Muted>
                                      {summary.subtitle ||
                                        `${summary.type}:${summary.id}`}
                                    </Muted>
                                  </Column>
                                </CommentIdentityRow>
                              );
                            })()}
                            <Muted>
                              {entry.content.report_reason ||
                                "No reason provided"}
                            </Muted>
                            <InlineButtons>
                              <Tag data-state={entry.status}>
                                {entry.status}
                              </Tag>
                              <PrimaryButton
                                type="button"
                                data-tone="ghost"
                                onClick={() => void loadReportDetails(entry.id)}
                              >
                                Details
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>

                  <PaneTitle style={{ "margin-top": "6px" }}>
                    Dismissed Reports
                  </PaneTitle>
                  <ResultGrid>
                    <Show
                      when={dismissedReports().length > 0}
                      fallback={<Muted>No dismissed reports yet.</Muted>}
                    >
                      <For each={dismissedReports()}>
                        {(entry) => (
                          <ResultCard>
                            {(() => {
                              const summary = getReportTargetSummary(entry);
                              const media = getSummaryPrimaryMedia(summary);

                              return (
                                <CommentIdentityRow>
                                  <Show when={media}>
                                    {(src) => (
                                      <CommentIdentityImage
                                        src={src()}
                                        alt={summary.title}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                      />
                                    )}
                                  </Show>
                                  <Column gap="none">
                                    <Text>
                                      <strong>{summary.title}</strong>
                                    </Text>
                                    <Muted>
                                      {summary.subtitle ||
                                        `${summary.type}:${summary.id}`}
                                    </Muted>
                                  </Column>
                                </CommentIdentityRow>
                              );
                            })()}
                            <Muted>
                              {entry.content.report_reason ||
                                "No reason provided"}
                            </Muted>
                            <InlineButtons>
                              <Tag data-state={entry.status}>
                                {entry.status}
                              </Tag>
                              <PrimaryButton
                                type="button"
                                data-tone="ghost"
                                onClick={() => void loadReportDetails(entry.id)}
                              >
                                Details
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>

                  <Show when={selectedReport()}>
                    {(detail) => (
                      <ResultCard>
                        <Text>
                          <strong>Selected Report:</strong> {selectedReportId()}
                        </Text>
                        {(() => {
                          const summary = getReportTargetSummary(detail());
                          const media = getSummaryPrimaryMedia(summary);

                          return (
                            <ResultCard>
                              <CommentIdentityRow>
                                <Show when={media}>
                                  {(src) => (
                                    <CommentIdentityImage
                                      src={src()}
                                      alt={summary.title}
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                  )}
                                </Show>
                                <Column gap="none">
                                  <Text>
                                    <strong>{summary.title}</strong>
                                  </Text>
                                  <Muted>
                                    {summary.subtitle ||
                                      `${summary.type}:${summary.id}`}
                                  </Muted>
                                </Column>
                              </CommentIdentityRow>
                              <Muted>
                                Case:{" "}
                                {detail().caseId ||
                                  detail().caseItem?.id ||
                                  "none"}
                              </Muted>
                              <Muted>
                                Actions linked: {detail().actions?.length ?? 0}
                              </Muted>
                              <Muted>
                                Reason:{" "}
                                {detail().content.report_reason ||
                                  "No reason provided"}
                              </Muted>
                              <Muted>
                                Context:{" "}
                                {detail().additional_context || "No context"}
                              </Muted>

                              <Show
                                when={
                                  Array.isArray(detail().actions) &&
                                  detail().actions!.length > 0
                                }
                              >
                                <Timeline>
                                  <For each={detail().actions || []}>
                                    {(action) => (
                                      <TimelineItem>
                                        <TimelineTitle>
                                          {action.actionType} - {action.reason}
                                        </TimelineTitle>
                                        <TimelineMeta>
                                          target: {action.targetType}:
                                          {action.targetId}
                                        </TimelineMeta>
                                      </TimelineItem>
                                    )}
                                  </For>
                                </Timeline>
                              </Show>

                              <Show
                                when={
                                  summary.type === "image" &&
                                  getSummaryPrimaryMedia(summary)
                                }
                              >
                                {(imageSrc) => (
                                  <CommentAssetImage
                                    src={imageSrc()}
                                    alt={summary.title}
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                              </Show>

                              <Show
                                when={
                                  summary.type === "message" && detail().target
                                }
                              >
                                <ResultCard>
                                  <PaneTitle>Message Snapshot</PaneTitle>
                                  <Muted>
                                    {typeof (
                                      detail().target as Record<string, unknown>
                                    ).content === "string"
                                      ? String(
                                          (
                                            detail().target as Record<
                                              string,
                                              unknown
                                            >
                                          ).content,
                                        )
                                      : "No message content available"}
                                  </Muted>
                                </ResultCard>
                              </Show>
                            </ResultCard>
                          );
                        })()}
                        <label>
                          Status Note
                          <input
                            value={reportStatusNote()}
                            placeholder="optional triage note"
                            onInput={(event) =>
                              setReportStatusNote(event.currentTarget.value)
                            }
                          />
                        </label>
                        <InlineButtons>
                          <PrimaryButton
                            type="button"
                            data-tone="warning"
                            onClick={() =>
                              void changeReportStatus(
                                detail().id,
                                "investigating",
                                reportStatusNote(),
                              )
                            }
                          >
                            Move to Investigating
                          </PrimaryButton>
                          <PrimaryButton
                            type="button"
                            data-tone="success"
                            onClick={() =>
                              void changeReportStatus(
                                detail().id,
                                "resolved",
                                reportStatusNote(),
                              )
                            }
                          >
                            Mark Resolved
                          </PrimaryButton>
                        </InlineButtons>
                      </ResultCard>
                    )}
                  </Show>
                </Pane>

                <Board>
                  <For each={CASE_STATUSES}>
                    {(status) => (
                      <BoardColumn>
                        <BoardHeading>{status}</BoardHeading>
                        <ResultGrid>
                          <Show
                            when={casesByStatus()[status].length > 0}
                            fallback={<Muted>No entries</Muted>}
                          >
                            <For each={casesByStatus()[status]}>
                              {(entry) => (
                                <ResultCard>
                                  {(() => {
                                    const summary = entry.targetSummary
                                      ? {
                                          type: entry.targetSummary.type,
                                          id: entry.targetSummary.id,
                                          title: entry.targetSummary.title,
                                          subtitle:
                                            entry.targetSummary.subtitle,
                                          avatar: entry.targetSummary.avatar,
                                          iconURL: entry.targetSummary.iconURL,
                                          imageURL:
                                            entry.targetSummary.imageURL,
                                        }
                                      : {
                                          type: entry.target.type,
                                          id: entry.target.id,
                                          title: entry.target.id,
                                        };
                                    const media =
                                      getSummaryPrimaryMedia(summary);

                                    return (
                                      <CommentIdentityRow>
                                        <Show when={media}>
                                          {(src) => (
                                            <CommentIdentityImage
                                              src={src()}
                                              alt={summary.title}
                                              loading="lazy"
                                              referrerPolicy="no-referrer"
                                            />
                                          )}
                                        </Show>
                                        <Column gap="none">
                                          <Text>
                                            <strong>{summary.title}</strong>
                                          </Text>
                                          <Muted>
                                            {summary.subtitle ||
                                              `${summary.type}:${summary.id}`}
                                          </Muted>
                                        </Column>
                                      </CommentIdentityRow>
                                    );
                                  })()}
                                  <Muted>{entry.reason}</Muted>
                                  <InlineButtons>
                                    <PrimaryButton
                                      type="button"
                                      data-tone="ghost"
                                      onClick={() => {
                                        if (entry.target.type === "user") {
                                          void loadUserInspector(
                                            entry.target.id,
                                          );
                                          return;
                                        }

                                        if (entry.target.type === "server") {
                                          void loadServerInspector(
                                            entry.target.id,
                                          );
                                          return;
                                        }

                                        if (entry.target.type === "image") {
                                          void loadImageInspector(
                                            entry.target.id,
                                          );
                                          return;
                                        }

                                        navigate(
                                          `/moderation/${entry.target.type}/${entry.target.id}`,
                                        );
                                      }}
                                    >
                                      Inspect
                                    </PrimaryButton>
                                    <PrimaryButton
                                      type="button"
                                      data-tone="warning"
                                      onClick={() =>
                                        void changeCaseStatus(
                                          entry.id,
                                          "investigating",
                                        )
                                      }
                                    >
                                      Review
                                    </PrimaryButton>
                                    <PrimaryButton
                                      type="button"
                                      data-tone="success"
                                      onClick={() =>
                                        void changeCaseStatus(
                                          entry.id,
                                          "resolved",
                                        )
                                      }
                                    >
                                      Resolve
                                    </PrimaryButton>
                                    <PrimaryButton
                                      type="button"
                                      data-tone="danger"
                                      onClick={() =>
                                        void changeCaseStatus(
                                          entry.id,
                                          "dismissed",
                                        )
                                      }
                                    >
                                      Dismiss
                                    </PrimaryButton>
                                  </InlineButtons>
                                </ResultCard>
                              )}
                            </For>
                          </Show>
                        </ResultGrid>
                      </BoardColumn>
                    )}
                  </For>
                </Board>
              </Show>

              <Show when={stage() === "staff"}>
                <Pane>
                  <PaneTitle>Team Access</PaneTitle>
                  <Show
                    when={bootstrap()?.scopes.manageModerators}
                    fallback={<Muted>No permission to manage staff.</Muted>}
                  >
                    <FormGrid>
                      <label>
                        User ID
                        <input
                          value={moderatorUserId()}
                          onInput={(event) =>
                            setModeratorUserId(event.currentTarget.value)
                          }
                        />
                      </label>
                      <label>
                        Role
                        <select
                          value={moderatorRole()}
                          onInput={(event) =>
                            setModeratorRole(
                              event.currentTarget.value as
                                | "owner"
                                | "admin"
                                | "moderator",
                            )
                          }
                        >
                          <option value="moderator">moderator</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>
                      </label>
                      <PrimaryButton
                        type="button"
                        data-tone="primary"
                        disabled={loading()}
                        onClick={() => void saveModerator()}
                      >
                        Save Access
                      </PrimaryButton>
                    </FormGrid>
                  </Show>
                </Pane>

                <Pane>
                  <PaneTitle>Current Team</PaneTitle>
                  <ResultGrid>
                    <Show
                      when={moderators().length > 0}
                      fallback={<Muted>No staff records.</Muted>}
                    >
                      <For each={moderators()}>
                        {(entry) => (
                          <ResultCard>
                            <Text>
                              <strong>{entry.userId}</strong>
                            </Text>
                            <Tag>{entry.role}</Tag>
                            <InlineButtons>
                              <PrimaryButton
                                type="button"
                                data-tone="danger"
                                disabled={
                                  !bootstrap()?.scopes.manageModerators ||
                                  loading()
                                }
                                onClick={() =>
                                  void removeModeratorEntry(entry.userId)
                                }
                              >
                                Remove
                              </PrimaryButton>
                            </InlineButtons>
                          </ResultCard>
                        )}
                      </For>
                    </Show>
                  </ResultGrid>
                </Pane>
              </Show>
            </WorkArea>
          </Layout>
        </Show>
      </Show>
    </Surface>
  );
}

const Surface = styled("div", {
  base: {
    minWidth: 0,
    flexGrow: 1,
    overflow: "auto",
    maxWidth: "1400px",
    marginInline: "auto",
    padding: "2rem",
    display: "grid",
    gap: "16px",
    background:
      "radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--md-sys-color-primary-container) 46%, transparent) 0%, transparent 45%), radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--md-sys-color-secondary-container) 40%, transparent) 0%, transparent 38%), var(--md-sys-color-surface)",
    mdDown: {
      padding: "1rem",
      gap: "10px",
    },
  },
});

const Hero = styled("section", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "18px",
    padding: "20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
    background:
      "linear-gradient(145deg, color-mix(in srgb, var(--md-sys-color-surface-container-highest) 82%, transparent), color-mix(in srgb, var(--md-sys-color-surface-container) 88%, transparent))",
    boxShadow: "0 10px 28px rgba(12, 19, 36, 0.12)",
    mdDown: {
      padding: "12px",
      gap: "10px",
    },
  },
});

const Headline = styled("h1", {
  base: {
    margin: 0,
    fontSize: "clamp(1.45rem, 2.6vw, 2.2rem)",
    letterSpacing: "0.01em",
    fontWeight: "780",
    lineHeight: 1.1,
  },
});

const Subline = styled("p", {
  base: {
    margin: 0,
    marginTop: "5px",
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "13px",
    maxWidth: "66ch",
    mdDown: {
      fontSize: "12px",
    },
  },
});

const HeroActions = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
});

const Failure = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-error)",
    borderRadius: "10px",
    padding: "10px 12px",
    background: "var(--md-sys-color-error-container)",
    color: "var(--md-sys-color-on-error-container)",
  },
});

const Notice = styled("div", {
  base: {
    border: "1px dashed var(--md-sys-color-outline)",
    borderRadius: "12px",
    padding: "14px",
    color: "var(--md-sys-color-on-surface-variant)",
    background: "var(--md-sys-color-surface-container-high)",
  },
});

const Layout = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "260px minmax(0, 1fr)",
    gap: "16px",
    mdDown: {
      gridTemplateColumns: "1fr",
      gap: "10px",
    },
  },
});

const Rail = styled("aside", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "16px",
    background: "var(--md-sys-color-surface-container)",
    padding: "16px",
    display: "grid",
    gap: "9px",
    alignContent: "start",
    height: "fit-content",
    position: "sticky",
    top: "12px",
    boxShadow: "0 8px 22px rgba(14, 21, 36, 0.08)",
    mdDown: {
      position: "static",
      display: "flex",
      flexWrap: "wrap",
      alignItems: "stretch",
      gap: "6px",
    },
  },
});

const RailBrand = styled("div", {
  base: {
    display: "grid",
    gap: "3px",
    paddingBottom: "8px",
    borderBottom: "1px solid var(--md-sys-color-outline-variant)",
    marginBottom: "2px",
    mdDown: {
      width: "100%",
    },
  },
});

const BrandTitle = styled("div", {
  base: {
    fontSize: "15px",
    fontWeight: "760",
    color: "var(--md-sys-color-on-surface)",
  },
});

const BrandSubline = styled("div", {
  base: {
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const RailHeader = styled("div", {
  base: {
    fontSize: "11px",
    letterSpacing: "0.08em",
    fontWeight: "750",
    textTransform: "uppercase",
    color: "var(--md-sys-color-on-surface-variant)",
    marginTop: "4px",
    mdDown: {
      width: "100%",
      marginTop: "0px",
    },
  },
});

const RailButton = styled("button", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "10px",
    minHeight: "42px",
    textAlign: "left",
    padding: "8px 12px",
    background: "var(--md-sys-color-surface-container-high)",
    color: "var(--md-sys-color-on-surface)",
    fontSize: "12px",
    fontWeight: "730",
    cursor: "pointer",
    whiteSpace: "nowrap",
    '&[data-active="true"]': {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    mdDown: {
      flex: "1 1 145px",
    },
  },
});

const MetricTile = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container-highest)",
    padding: "9px",
    display: "grid",
    gap: "2px",
    mdDown: {
      flex: "1 1 calc(33% - 4px)",
      minWidth: "112px",
    },
  },
});

const MetricLabel = styled("div", {
  base: {
    fontSize: "11px",
    color: "var(--md-sys-color-on-surface-variant)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
});

const MetricValue = styled("div", {
  base: {
    fontSize: "24px",
    fontWeight: "820",
    lineHeight: 1,
  },
});

const WorkArea = styled("div", {
  base: {
    display: "grid",
    gap: "12px",
    mdDown: {
      gap: "10px",
    },
  },
});

const Pane = styled("section", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "16px",
    background: "var(--md-sys-color-surface-container)",
    padding: "16px",
    display: "grid",
    gap: "12px",
    boxShadow: "0 8px 22px rgba(14, 21, 36, 0.08)",
    mdDown: {
      padding: "12px",
    },
  },
});

const PaneTitle = styled("h2", {
  base: {
    margin: 0,
    fontSize: "15px",
    fontWeight: "760",
    letterSpacing: "0.01em",
    color: "var(--md-sys-color-on-surface)",
  },
});

const Toolbar = styled("div", {
  base: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    "& input, & select": {
      border: "1px solid var(--md-sys-color-outline-variant)",
      borderRadius: "10px",
      minHeight: "38px",
      padding: "7px 10px",
      background: "var(--md-sys-color-surface-container-highest)",
      color: "var(--md-sys-color-on-surface)",
      fontSize: "13px",
      flex: "1 1 180px",
    },
    "& select": {
      flex: "0 0 160px",
    },
    mdDown: {
      "& input, & select, & button": {
        flex: "1 1 100%",
      },
    },
  },
});

const ResultGrid = styled("div", {
  base: {
    display: "grid",
    gap: "8px",
  },
});

const ResultCard = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "14px",
    background: "var(--md-sys-color-surface-container-highest)",
    padding: "12px",
    display: "grid",
    gap: "8px",
  },
});

const MediaGrid = styled("div", {
  base: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
});

const MediaTile = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container-high)",
    padding: "8px",
    display: "grid",
    gap: "6px",
  },
});

const MediaLabel = styled("div", {
  base: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const MediaImage = styled("img", {
  base: {
    width: "100%",
    height: "120px",
    objectFit: "cover",
    borderRadius: "8px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-highest)",
    '&[data-shape="round"]': {
      width: "64px",
      height: "64px",
      borderRadius: "999px",
    },
  },
});

const Muted = styled("p", {
  base: {
    margin: 0,
    color: "var(--md-sys-color-on-surface-variant)",
    fontSize: "12px",
  },
});

const InlineButtons = styled("div", {
  base: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
});

const CheckboxRow = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  },
});

const PrimaryButton = styled("button", {
  base: {
    border: "1px solid var(--md-sys-color-outline)",
    borderRadius: "10px",
    minHeight: "38px",
    padding: "7px 14px",
    fontSize: "12px",
    fontWeight: "740",
    cursor: "pointer",
    background: "var(--md-sys-color-surface-container-highest)",
    color: "var(--md-sys-color-on-surface)",
    '&[data-tone="primary"]': {
      borderColor: "var(--md-sys-color-primary)",
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    '&[data-tone="warning"]': {
      borderColor: "var(--md-sys-color-tertiary)",
      background: "var(--md-sys-color-tertiary-container)",
      color: "var(--md-sys-color-on-tertiary-container)",
    },
    '&[data-tone="success"]': {
      borderColor: "var(--md-sys-color-secondary)",
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
    '&[data-tone="danger"]': {
      borderColor: "var(--md-sys-color-error)",
      background: "var(--md-sys-color-error-container)",
      color: "var(--md-sys-color-on-error-container)",
    },
    '&[data-tone="ghost"]': {
      borderColor: "var(--md-sys-color-outline-variant)",
      background: "var(--md-sys-color-surface)",
      color: "var(--md-sys-color-on-surface)",
    },
    "&:disabled": {
      opacity: 0.5,
      cursor: "not-allowed",
    },
  },
});

const Tag = styled("span", {
  base: {
    width: "fit-content",
    borderRadius: "999px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    padding: "3px 8px",
    fontSize: "11px",
    textTransform: "capitalize",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface-variant)",
    '&[data-state="open"]': {
      background: "var(--md-sys-color-primary-container)",
      color: "var(--md-sys-color-on-primary-container)",
    },
    '&[data-state="investigating"]': {
      background: "var(--md-sys-color-tertiary-container)",
      color: "var(--md-sys-color-on-tertiary-container)",
    },
    '&[data-state="resolved"]': {
      background: "var(--md-sys-color-secondary-container)",
      color: "var(--md-sys-color-on-secondary-container)",
    },
    '&[data-state="dismissed"]': {
      background:
        "color-mix(in srgb, var(--md-sys-color-error-container) 70%, transparent)",
      color: "var(--md-sys-color-on-error-container)",
    },
  },
});

const FormGrid = styled("div", {
  base: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    "& label": {
      display: "grid",
      gap: "4px",
      fontSize: "12px",
      fontWeight: "700",
      color: "var(--md-sys-color-on-surface)",
    },
    "& input, & select": {
      border: "1px solid var(--md-sys-color-outline-variant)",
      borderRadius: "10px",
      minHeight: "38px",
      background: "var(--md-sys-color-surface-container-highest)",
      color: "var(--md-sys-color-on-surface)",
      padding: "7px 10px",
      fontSize: "13px",
      width: "100%",
    },
    "& textarea": {
      border: "1px solid var(--md-sys-color-outline-variant)",
      borderRadius: "10px",
      minHeight: "110px",
      background: "var(--md-sys-color-surface-container-highest)",
      color: "var(--md-sys-color-on-surface)",
      padding: "8px 10px",
      fontSize: "13px",
      width: "100%",
      resize: "vertical",
    },
  },
});

const PresetGrid = styled("div", {
  base: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    mdDown: {
      gridTemplateColumns: "1fr",
    },
  },
});

const PresetColumn = styled("div", {
  base: {
    display: "grid",
    gap: "6px",
    alignContent: "start",
  },
});

const PresetHeading = styled("div", {
  base: {
    fontSize: "12px",
    fontWeight: "730",
    color: "var(--md-sys-color-on-surface)",
  },
});

const Timeline = styled("div", {
  base: {
    display: "grid",
    gap: "8px",
  },
});

const TimelineItem = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "10px",
    background: "var(--md-sys-color-surface-container-high)",
    padding: "8px 10px",
    display: "grid",
    gap: "4px",
  },
});

const TimelineTitle = styled("div", {
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
  },
});

const TimelineMeta = styled("div", {
  base: {
    fontSize: "11px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const TimelineMarkdown = styled("div", {
  base: {
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
    "& p": {
      margin: 0,
    },
    "& a": {
      color: "var(--md-sys-color-primary)",
      textDecoration: "underline",
    },
  },
});

const CommentIdentityRow = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
});

const CommentIdentityImage = styled("img", {
  base: {
    width: "34px",
    height: "34px",
    borderRadius: "999px",
    objectFit: "cover",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-high)",
  },
});

const CommentAssetGrid = styled("div", {
  base: {
    display: "grid",
    gap: "6px",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
});

const CommentAssetCard = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "8px",
    padding: "8px",
    background: "var(--md-sys-color-surface-container-highest)",
    display: "grid",
    gap: "6px",
    "& a": {
      fontSize: "12px",
      color: "var(--md-sys-color-primary)",
      textDecoration: "underline",
      wordBreak: "break-all",
    },
  },
});

const CommentAssetImage = styled("img", {
  base: {
    width: "100%",
    maxHeight: "180px",
    objectFit: "cover",
    borderRadius: "7px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface-container-high)",
  },
});

const Board = styled("section", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "10px",
    mdDown: {
      gridTemplateColumns: "1fr",
    },
  },
});

const BoardColumn = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "14px",
    background: "var(--md-sys-color-surface-container)",
    padding: "12px",
    display: "grid",
    gap: "8px",
    alignContent: "start",
    minHeight: "240px",
  },
});

const BoardHeading = styled("h3", {
  base: {
    margin: 0,
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

const QuickActionsGrid = styled("div", {
  base: {
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  },
});

const ModuleGrid = styled("div", {
  base: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  },
});

const ModuleCard = styled("div", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "12px",
    background: "var(--md-sys-color-surface-container-high)",
    padding: "12px",
    display: "grid",
    gap: "8px",
    alignContent: "start",
  },
});

const KpiRow = styled("section", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "10px",
    mdDown: {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
});

const KpiCard = styled("article", {
  base: {
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "14px",
    background: "var(--md-sys-color-surface-container-high)",
    padding: "12px",
    display: "grid",
    gap: "2px",
    boxShadow: "0 6px 14px rgba(12, 19, 36, 0.08)",
  },
});

const KpiTitle = styled("div", {
  base: {
    fontSize: "11px",
    color: "var(--md-sys-color-on-surface-variant)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
});

const KpiNumber = styled("div", {
  base: {
    fontSize: "28px",
    fontWeight: "800",
    lineHeight: 1,
    color: "var(--md-sys-color-on-surface)",
  },
});

const KpiHint = styled("div", {
  base: {
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});
