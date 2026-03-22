import console from "node:console";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

import { MongoClient } from "mongodb";

const USER_FLAG_SUSPENDED = 1;
const USER_FLAG_BANNED = 4;

const DEFAULT_SCOPES = Object.freeze({
  viewPanel: false,
  manageModerators: false,
  moderateUsers: false,
  moderateMessages: false,
  moderateServers: false,
  moderateImages: false,
  manageCases: false,
});

const ROLE_TEMPLATES = Object.freeze({
  owner: {
    viewPanel: true,
    manageModerators: true,
    moderateUsers: true,
    moderateMessages: true,
    moderateServers: true,
    moderateImages: true,
    manageCases: true,
  },
  admin: {
    viewPanel: true,
    manageModerators: true,
    moderateUsers: true,
    moderateMessages: true,
    moderateServers: true,
    moderateImages: true,
    manageCases: true,
  },
  moderator: {
    viewPanel: true,
    manageModerators: false,
    moderateUsers: true,
    moderateMessages: true,
    moderateServers: true,
    moderateImages: true,
    manageCases: true,
  },
});

const ACTION_MAP = Object.freeze({
  warn: "strike",
  strike: "strike",
  ban: "ban",
  unban: "note",
  kick: "note",
  mute: "note",
  unmute: "note",
  timeout: "note",
  untimeout: "note",
  delete_message: "note",
  restore_message: "note",
  delete_server: "note",
  disable_server: "note",
  delete_image: "note",
  note: "note",
  label_user: "note",
  clear_flags: "note",
});

function normalizeRole(value) {
  if (value === "owner" || value === "admin" || value === "moderator") {
    return value;
  }

  return "moderator";
}

function normalizeScopes(input, role = "moderator") {
  const template = ROLE_TEMPLATES[normalizeRole(role)] ?? DEFAULT_SCOPES;
  const scopes = { ...DEFAULT_SCOPES, ...template };

  if (!input || typeof input !== "object") {
    return scopes;
  }

  for (const key of Object.keys(DEFAULT_SCOPES)) {
    if (typeof input[key] === "boolean") {
      scopes[key] = input[key];
    }
  }

  return scopes;
}

function normalizeCaseStatus(status) {
  if (
    status === "open" ||
    status === "investigating" ||
    status === "resolved" ||
    status === "dismissed"
  ) {
    return status;
  }

  return "open";
}

function normalizeReportStatus(status) {
  if (
    status === "open" ||
    status === "investigating" ||
    status === "resolved" ||
    status === "dismissed"
  ) {
    return status;
  }

  return "open";
}

function normalizeTargetType(value) {
  if (
    value === "user" ||
    value === "message" ||
    value === "server" ||
    value === "image"
  ) {
    return value;
  }

  return undefined;
}

function normalizeLimit(value, fallback = 25, max = 100) {
  return Math.min(Math.max(Number(value) || fallback, 1), max);
}

function normalizePage(value) {
  return Math.max(Number(value) || 1, 1);
}

function normalizeSortDirection(value) {
  if (value === "asc") return 1;
  if (value === "desc") return -1;
  return -1;
}

function now() {
  return new Date();
}

function trimText(value, max = 512) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function normalizeHttpUrl(value) {
  const text = trimText(value, 2048);
  if (!text) return "";

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toUnixTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function toBitfield(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return undefined;
}

function summarizeMessage(message) {
  if (!message || typeof message !== "object") return undefined;

  return {
    id: typeof message._id === "string" ? message._id : undefined,
    authorId: typeof message.author === "string" ? message.author : undefined,
    channelId:
      typeof message.channel === "string" ? message.channel : undefined,
    content: typeof message.content === "string" ? message.content : undefined,
    flags: typeof message.flags === "number" ? message.flags : undefined,
  };
}

function normalizeCommentAttachments(input, { assignIds = false } = {}) {
  if (!Array.isArray(input)) {
    return [];
  }

  const items = [];

  for (const entry of input.slice(0, 16)) {
    let id;
    let url = "";
    let filename;
    let contentType;
    let size;

    if (typeof entry === "string") {
      url = normalizeHttpUrl(entry);
    } else if (entry && typeof entry === "object") {
      id = trimText(entry.id, 128);
      url = normalizeHttpUrl(entry.url);
      filename = trimText(entry.filename, 260);
      contentType = trimText(entry.contentType, 128);
      const numericSize = Number(entry.size);
      size =
        Number.isFinite(numericSize) && numericSize >= 0
          ? Math.trunc(numericSize)
          : undefined;
    }

    if (!url) {
      continue;
    }

    const normalized = {
      url,
    };

    if (assignIds) {
      normalized.id = id || randomUUID();
    } else if (id) {
      normalized.id = id;
    }

    if (filename) {
      normalized.filename = filename;
    }

    if (contentType) {
      normalized.contentType = contentType;
    }

    if (typeof size === "number") {
      normalized.size = size;
    }

    items.push(normalized);
  }

  return items;
}

function normalizeCommentEmbeds(input, { assignIds = false } = {}) {
  if (!Array.isArray(input)) {
    return [];
  }

  const items = [];

  for (const entry of input.slice(0, 16)) {
    let id;
    let url = "";
    let title = "";
    let description = "";
    let image = "";

    if (typeof entry === "string") {
      url = normalizeHttpUrl(entry);
      title = url;
    } else if (entry && typeof entry === "object") {
      id = trimText(entry.id, 128);
      url = normalizeHttpUrl(entry.url);
      title = trimText(entry.title, 180);
      description = trimText(entry.description, 1200);
      image = normalizeHttpUrl(entry.image);
    }

    if (!url && !title && !description && !image) {
      continue;
    }

    const normalized = {};

    if (assignIds) {
      normalized.id = id || randomUUID();
    } else if (id) {
      normalized.id = id;
    }

    if (url) {
      normalized.url = url;
    }

    if (title) {
      normalized.title = title;
    }

    if (description) {
      normalized.description = description;
    }

    if (image) {
      normalized.image = image;
    }

    items.push(normalized);
  }

  return items;
}

export function createModerationStore({
  mongoUri,
  dbName = "revolt",
  rolesCollectionName = "moderation_roles",
  casesCollectionName = "safety_cases",
  reportsCollectionName = "safety_reports",
  actionsCollectionName = "safety_strikes",
  snapshotsCollectionName = "safety_snapshots",
  usersCollectionName = "users",
  serversCollectionName = "servers",
  imagesCollectionName = "attachments",
  messagesCollectionName = "messages",
  userCommentsCollectionName = "moderation_user_comments",
  serverCommentsCollectionName = "moderation_server_comments",
  imageCommentsCollectionName = "moderation_image_comments",
  notificationApiBase = "https://api.revolt.chat",
  notificationSystemSessionToken,
  notificationEmailWebhookUrl,
  superuserIds = [],
  logger = console,
}) {
  let client;
  let rolesCollection;
  let casesCollection;
  let reportsCollection;
  let actionsCollection;
  let snapshotsCollection;
  let usersCollection;
  let serversCollection;
  let imagesCollection;
  let messagesCollection;
  let userCommentsCollection;
  let serverCommentsCollection;
  let imageCommentsCollection;

  const superusers = new Set(superuserIds.filter(Boolean));

  async function connect() {
    if (!mongoUri || !dbName) {
      logger.warn(
        "[moderation] missing MONGODB_URI or DB name, moderation store disabled",
      );
      return;
    }

    client = new MongoClient(mongoUri);
    await client.connect();

    const db = client.db(dbName);

    rolesCollection = db.collection(rolesCollectionName);
    casesCollection = db.collection(casesCollectionName);
    reportsCollection = db.collection(reportsCollectionName);
    actionsCollection = db.collection(actionsCollectionName);
    snapshotsCollection = db.collection(snapshotsCollectionName);
    usersCollection = db.collection(usersCollectionName);
    serversCollection = db.collection(serversCollectionName);
    imagesCollection = db.collection(imagesCollectionName);
    messagesCollection = db.collection(messagesCollectionName);
    userCommentsCollection = db.collection(userCommentsCollectionName);
    serverCommentsCollection = db.collection(serverCommentsCollectionName);
    imageCommentsCollection = db.collection(imageCommentsCollectionName);

    await rolesCollection.createIndex({ userId: 1 }, { unique: true });
    await casesCollection.createIndex({ status: 1 });
    await casesCollection.createIndex({ author: 1, status: 1 });
    await reportsCollection.createIndex({ status: 1 });
    await reportsCollection.createIndex({ case_id: 1, status: 1 });
    await reportsCollection.createIndex({ "content.type": 1, "content.id": 1 });
    await actionsCollection.createIndex({ case_id: 1 });
    await actionsCollection.createIndex({ user_id: 1, type: 1 });
    await actionsCollection.createIndex({ target_type: 1, target_id: 1 });
    // _id is already indexed uniquely by MongoDB; skip explicit index creation.
    await userCommentsCollection.createIndex({ user_id: 1, created_at: -1 });
    await serverCommentsCollection.createIndex({
      server_id: 1,
      created_at: -1,
    });
    await imageCommentsCollection.createIndex({ image_id: 1, created_at: -1 });

    logger.info(
      `[moderation] ready with ${dbName}.${reportsCollectionName}/${casesCollectionName}/${actionsCollectionName}`,
    );
  }

  function normalizeModerator(document) {
    if (!document) return undefined;

    const userId = trimText(String(document.userId ?? ""), 128);
    if (!userId) return undefined;

    const role = normalizeRole(document.role);
    return {
      userId,
      role,
      scopes: normalizeScopes(document.scopes, role),
      updatedAt:
        document.updatedAt instanceof Date
          ? document.updatedAt.getTime()
          : Date.now(),
      updatedBy:
        typeof document.updatedBy === "string" ? document.updatedBy : undefined,
    };
  }

  async function getPermissionsForUser(userId) {
    if (!userId) {
      return { role: "none", scopes: { ...DEFAULT_SCOPES } };
    }

    if (superusers.has(userId)) {
      return {
        role: "owner",
        scopes: normalizeScopes(undefined, "owner"),
      };
    }

    if (!rolesCollection) {
      return { role: "none", scopes: { ...DEFAULT_SCOPES } };
    }

    const row = await rolesCollection.findOne({ userId });
    const mapped = normalizeModerator(row);

    if (!mapped) {
      return { role: "none", scopes: { ...DEFAULT_SCOPES } };
    }

    return {
      role: mapped.role,
      scopes: mapped.scopes,
    };
  }

  async function listModerators() {
    if (!rolesCollection) return [];

    const rows = await rolesCollection
      .find(
        {},
        {
          projection: {
            _id: 0,
            userId: 1,
            role: 1,
            scopes: 1,
            updatedAt: 1,
            updatedBy: 1,
          },
        },
      )
      .sort({ updatedAt: -1 })
      .toArray();

    const moderators = rows.map(normalizeModerator).filter(Boolean);
    const known = new Set(moderators.map((entry) => entry.userId));

    for (const userId of superusers) {
      if (!known.has(userId)) {
        moderators.unshift({
          userId,
          role: "owner",
          scopes: normalizeScopes(undefined, "owner"),
          updatedAt: Date.now(),
          updatedBy: "system",
        });
      }
    }

    return moderators;
  }

  async function upsertModerator(actorUserId, payload) {
    if (!rolesCollection || !payload || typeof payload !== "object") {
      return undefined;
    }

    const userId = trimText(payload.userId, 128);
    if (!userId) return undefined;

    if (superusers.has(userId)) {
      return {
        userId,
        role: "owner",
        scopes: normalizeScopes(undefined, "owner"),
        updatedAt: Date.now(),
        updatedBy: actorUserId,
      };
    }

    const role = normalizeRole(payload.role);
    const scopes = normalizeScopes(payload.scopes, role);
    const updatedAt = now();

    await rolesCollection.updateOne(
      { userId },
      {
        $set: {
          userId,
          role,
          scopes,
          updatedBy: actorUserId,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return {
      userId,
      role,
      scopes,
      updatedAt: updatedAt.getTime(),
      updatedBy: actorUserId,
    };
  }

  async function removeModerator(userId) {
    if (!rolesCollection || !userId) return false;
    if (superusers.has(userId)) return false;

    const result = await rolesCollection.deleteOne({ userId });
    return result.deletedCount > 0;
  }

  async function listReports({
    status,
    targetType,
    targetId,
    query,
    page = 1,
    limit = 50,
    sortBy = "createdAt",
    sortDirection = "desc",
  } = {}) {
    if (!reportsCollection) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit: normalizeLimit(limit, 50, 250),
      };
    }

    const findQuery = {};

    if (typeof status === "string" && status.trim()) {
      findQuery.status = normalizeReportStatus(status.trim());
    }

    const normalizedType = normalizeTargetType(targetType);
    if (normalizedType) {
      findQuery["content.type"] = normalizedType;
    }

    const normalizedTargetId = trimText(targetId, 128);
    if (normalizedTargetId) {
      findQuery["content.id"] = normalizedTargetId;
    }

    const normalizedQuery = trimText(query, 128);
    if (normalizedQuery) {
      const matcher = { $regex: escapeRegex(normalizedQuery), $options: "i" };
      findQuery.$or = [
        { additional_context: matcher },
        { "content.id": matcher },
        { "content.report_reason": matcher },
        { author_id: matcher },
      ];
    }

    const normalizedLimit = normalizeLimit(limit, 50, 250);
    const normalizedPage = normalizePage(page);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const normalizedDirection = normalizeSortDirection(sortDirection);
    const sortField =
      sortBy === "status"
        ? "status"
        : sortBy === "updatedAt"
          ? "updated_at"
          : "_id";

    const [rows, total] = await Promise.all([
      reportsCollection
        .find(findQuery)
        .sort({ [sortField]: normalizedDirection })
        .skip(skip)
        .limit(normalizedLimit)
        .toArray(),
      reportsCollection.countDocuments(findQuery),
    ]);

    const items = await Promise.all(
      rows.map(async (row) => {
        const normalizedType =
          normalizeTargetType(row?.content?.type) ?? "user";
        const normalizedId =
          typeof row?.content?.id === "string"
            ? row.content.id
            : String(row._id);

        return {
          id: String(row._id),
          status: normalizeReportStatus(row.status),
          authorId:
            typeof row.author_id === "string" ? row.author_id : undefined,
          caseId: typeof row.case_id === "string" ? row.case_id : undefined,
          content: {
            type: normalizedType,
            id: normalizedId,
            report_reason:
              typeof row?.content?.report_reason === "string"
                ? row.content.report_reason
                : "NoneSpecified",
          },
          targetSummary: await buildTargetSummary(normalizedType, normalizedId),
          additional_context:
            typeof row.additional_context === "string"
              ? row.additional_context
              : "",
          notes: Array.isArray(row.notes) ? row.notes : [],
        };
      }),
    );

    return {
      items,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }

  async function getReportById(reportId) {
    if (!reportsCollection || !reportId) return undefined;

    const row = await reportsCollection.findOne({ _id: reportId });
    if (!row) return undefined;

    const targetType = normalizeTargetType(row?.content?.type);
    const targetId =
      typeof row?.content?.id === "string" ? row.content.id : undefined;

    let target;
    if (targetType === "user" && targetId) {
      target = await getUserById(targetId);
    } else if (targetType === "server" && targetId) {
      target = await getServerById(targetId);
    } else if (targetType === "image" && targetId) {
      target = await getImageById(targetId);
    } else if (targetType === "message" && targetId) {
      target = await getMessageById(targetId);
    }

    const caseItem =
      typeof row.case_id === "string"
        ? await getCaseById(row.case_id)
        : undefined;

    const actions =
      typeof row.case_id === "string"
        ? await listActions({ caseId: row.case_id, limit: 100 })
        : { items: [] };

    return {
      id: String(row._id),
      status: normalizeReportStatus(row.status),
      authorId: typeof row.author_id === "string" ? row.author_id : undefined,
      caseId: typeof row.case_id === "string" ? row.case_id : undefined,
      content: {
        type: targetType ?? "user",
        id: targetId ?? String(row._id),
        report_reason:
          typeof row?.content?.report_reason === "string"
            ? row.content.report_reason
            : "NoneSpecified",
      },
      targetSummary:
        targetType && targetId
          ? await buildTargetSummary(targetType, targetId)
          : undefined,
      additional_context:
        typeof row.additional_context === "string"
          ? row.additional_context
          : "",
      notes: Array.isArray(row.notes) ? row.notes : [],
      target,
      caseItem,
      actions: actions.items,
    };
  }

  async function createReport({
    actorUserId,
    targetType,
    targetId,
    reportReason,
    additionalContext,
    autoCreateCase = true,
  }) {
    if (!reportsCollection) return undefined;

    const normalizedTargetType = normalizeTargetType(targetType);
    const normalizedTargetId = trimText(targetId, 128);
    const normalizedContext = trimText(additionalContext, 4000);
    const normalizedReason = trimText(reportReason, 120) || "NoneSpecified";

    if (!normalizedTargetType || !normalizedTargetId) {
      return undefined;
    }

    let caseId;
    if (autoCreateCase) {
      const createdCase = await createCase({
        actorUserId,
        targetType: normalizedTargetType,
        targetId: normalizedTargetId,
        reason:
          normalizedContext ||
          `Report on ${normalizedTargetType}:${normalizedTargetId}`,
        metadata: {
          source: "report",
          reportReason: normalizedReason,
        },
      });
      caseId = createdCase?.id;
    }

    const row = {
      _id: randomUUID(),
      author_id: actorUserId,
      case_id: caseId,
      status: "open",
      content: {
        type: normalizedTargetType,
        id: normalizedTargetId,
        report_reason: normalizedReason,
      },
      additional_context: normalizedContext,
      notes: [],
      created_at: now(),
      updated_at: now(),
    };

    await reportsCollection.insertOne(row);

    return {
      id: row._id,
      status: row.status,
      authorId: row.author_id,
      caseId: row.case_id,
      content: row.content,
      additional_context: row.additional_context,
      notes: row.notes,
    };
  }

  async function updateReportStatus({ reportId, status, actorUserId, note }) {
    if (!reportsCollection || !reportId) return undefined;

    const existingReport = await reportsCollection.findOne({ _id: reportId });
    if (!existingReport) return undefined;

    const normalizedStatus = normalizeReportStatus(status);
    const update = {
      status: normalizedStatus,
      updated_at: now(),
    };

    if (trimText(note, 2000)) {
      await reportsCollection.updateOne(
        { _id: reportId },
        {
          $set: update,
          $push: {
            notes: {
              id: randomUUID(),
              body: trimText(note, 2000),
              author: actorUserId,
              created_at: now(),
            },
          },
        },
      );
    } else {
      await reportsCollection.updateOne({ _id: reportId }, { $set: update });
    }

    if (casesCollection && typeof existingReport.case_id === "string") {
      const caseUpdate = {
        status: normalizeCaseStatus(normalizedStatus),
        updated_at: now(),
      };

      if (trimText(note, 2000)) {
        await casesCollection.updateOne(
          { _id: existingReport.case_id },
          {
            $set: caseUpdate,
            $push: {
              notes: {
                id: randomUUID(),
                body: `Report status changed to ${normalizedStatus}: ${trimText(note, 2000)}`,
                author: actorUserId,
                created_at: now(),
              },
            },
          },
        );
      } else {
        await casesCollection.updateOne(
          { _id: existingReport.case_id },
          { $set: caseUpdate },
        );
      }
    }

    return getReportById(reportId);
  }

  async function getCaseById(caseId) {
    if (!casesCollection || !caseId) return undefined;

    const row = await casesCollection.findOne({ _id: caseId });
    if (!row) return undefined;

    const linkedReport = await reportsCollection?.findOne({ case_id: caseId });
    const linkedTargetType = normalizeTargetType(linkedReport?.content?.type);
    const linkedTargetId =
      typeof linkedReport?.content?.id === "string"
        ? linkedReport.content.id
        : undefined;

    const targetSummary =
      linkedTargetType && linkedTargetId
        ? await buildTargetSummary(linkedTargetType, linkedTargetId)
        : undefined;

    return {
      id: String(row._id),
      status: normalizeCaseStatus(row.status),
      reason: typeof row.title === "string" ? row.title : "Case",
      evidence: typeof row.category === "string" ? row.category : undefined,
      createdBy: typeof row.author === "string" ? row.author : undefined,
      createdAt: toUnixTime(row.created_at) ?? Date.now(),
      updatedAt:
        toUnixTime(row.updated_at) ??
        toUnixTime(
          Array.isArray(row.notes)
            ? row.notes[row.notes.length - 1]?.created_at
            : undefined,
        ) ??
        Date.now(),
      target:
        linkedTargetType && linkedTargetId
          ? { type: linkedTargetType, id: linkedTargetId }
          : { type: "user", id: "unknown" },
      targetSummary,
      metadata: {
        category: row.category,
        notes: Array.isArray(row.notes) ? row.notes : [],
      },
    };
  }

  async function listCases({
    status,
    query,
    targetType,
    targetId,
    page = 1,
    limit = 50,
    sortBy = "updatedAt",
    sortDirection = "desc",
  } = {}) {
    if (!casesCollection) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit: normalizeLimit(limit, 50, 250),
      };
    }

    const findQuery = {};
    if (typeof status === "string" && status.trim()) {
      findQuery.status = normalizeCaseStatus(status.trim());
    }

    const normalizedQuery = trimText(query, 128);
    if (normalizedQuery) {
      findQuery.$or = [
        { title: { $regex: escapeRegex(normalizedQuery), $options: "i" } },
        { category: { $regex: escapeRegex(normalizedQuery), $options: "i" } },
      ];
    }

    const normalizedLimit = normalizeLimit(limit, 50, 250);
    const normalizedPage = normalizePage(page);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const normalizedDirection = normalizeSortDirection(sortDirection);
    const sortField = sortBy === "createdAt" ? "created_at" : "_id";

    let caseIdsByTarget;
    const normalizedTargetType = normalizeTargetType(targetType);
    const normalizedTargetId = trimText(targetId, 128);

    if (normalizedTargetType && normalizedTargetId && reportsCollection) {
      const linkedReports = await reportsCollection
        .find({
          "content.type": normalizedTargetType,
          "content.id": normalizedTargetId,
        })
        .project({ case_id: 1 })
        .toArray();

      caseIdsByTarget = linkedReports
        .map((entry) =>
          typeof entry.case_id === "string" ? entry.case_id : undefined,
        )
        .filter(Boolean);

      if (caseIdsByTarget.length === 0) {
        return {
          items: [],
          total: 0,
          page: normalizedPage,
          limit: normalizedLimit,
        };
      }

      findQuery._id = { $in: caseIdsByTarget };
    }

    const [rows, total] = await Promise.all([
      casesCollection
        .find(findQuery)
        .sort({ [sortField]: normalizedDirection })
        .skip(skip)
        .limit(normalizedLimit)
        .toArray(),
      casesCollection.countDocuments(findQuery),
    ]);

    const items = [];
    for (const row of rows) {
      const mapped = await getCaseById(row._id);
      if (mapped) items.push(mapped);
    }

    return {
      items,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }

  async function createCase({
    actorUserId,
    targetType,
    targetId,
    reason,
    evidence,
    metadata,
  }) {
    if (!casesCollection) return undefined;

    const normalizedTargetType = normalizeTargetType(targetType);
    const normalizedTargetId = trimText(targetId, 128);
    const normalizedReason = trimText(reason, 300) || "Moderation case";

    if (!normalizedTargetType || !normalizedTargetId) return undefined;

    const row = {
      _id: randomUUID(),
      author: actorUserId,
      title: normalizedReason,
      category: trimText(evidence, 120) || normalizedTargetType,
      status: "open",
      notes:
        metadata && typeof metadata === "object"
          ? [
              {
                id: randomUUID(),
                body: "Case created",
                metadata,
                author: actorUserId,
                created_at: now(),
              },
            ]
          : [],
      created_at: now(),
      updated_at: now(),
    };

    await casesCollection.insertOne(row);

    return {
      id: row._id,
      status: row.status,
      reason: row.title,
      evidence: row.category,
      createdBy: row.author,
      createdAt: row.created_at.getTime(),
      updatedAt: row.updated_at.getTime(),
      target: { type: normalizedTargetType, id: normalizedTargetId },
      metadata: { notes: row.notes },
    };
  }

  async function updateCaseStatus({ caseId, status, actorUserId, note }) {
    if (!casesCollection || !caseId) return undefined;

    const normalizedStatus = normalizeCaseStatus(status);

    if (trimText(note, 2000)) {
      await casesCollection.updateOne(
        { _id: caseId },
        {
          $set: {
            status: normalizedStatus,
            updated_at: now(),
          },
          $push: {
            notes: {
              id: randomUUID(),
              body: trimText(note, 2000),
              author: actorUserId,
              created_at: now(),
            },
          },
        },
      );
    } else {
      await casesCollection.updateOne(
        { _id: caseId },
        {
          $set: {
            status: normalizedStatus,
            updated_at: now(),
          },
        },
      );
    }

    return getCaseById(caseId);
  }

  async function getMessageById(messageId) {
    if (!messagesCollection || !messageId) return undefined;

    const doc = await messagesCollection.findOne({ _id: messageId });
    if (!doc) return undefined;

    return summarizeMessage(doc);
  }

  async function buildTargetSummary(targetType, targetId) {
    const normalizedType = normalizeTargetType(targetType);
    const normalizedTargetId = trimText(targetId, 128);

    if (!normalizedType || !normalizedTargetId) {
      return undefined;
    }

    if (normalizedType === "user") {
      const user = await getUserById(normalizedTargetId);
      if (!user) {
        return {
          type: normalizedType,
          id: normalizedTargetId,
          title: normalizedTargetId,
        };
      }

      const username =
        typeof user.username === "string" && user.username.trim()
          ? user.username
          : normalizedTargetId;
      const discriminator =
        typeof user.discriminator === "string" && user.discriminator.trim()
          ? `#${user.discriminator}`
          : "";

      return {
        type: normalizedType,
        id: normalizedTargetId,
        title: `${username}${discriminator}`,
        subtitle:
          typeof user.displayName === "string" && user.displayName.trim()
            ? user.displayName
            : undefined,
        avatar: user.avatar,
      };
    }

    if (normalizedType === "server") {
      const server = await getServerById(normalizedTargetId);
      if (!server) {
        return {
          type: normalizedType,
          id: normalizedTargetId,
          title: normalizedTargetId,
        };
      }

      return {
        type: normalizedType,
        id: normalizedTargetId,
        title:
          typeof server.name === "string" && server.name.trim()
            ? server.name
            : normalizedTargetId,
        subtitle:
          typeof server.ownerId === "string" && server.ownerId.trim()
            ? `Owner: ${server.ownerId}`
            : undefined,
        iconURL: server.iconURL,
      };
    }

    if (normalizedType === "image") {
      const image = await getImageById(normalizedTargetId);
      if (!image) {
        return {
          type: normalizedType,
          id: normalizedTargetId,
          title: normalizedTargetId,
        };
      }

      return {
        type: normalizedType,
        id: normalizedTargetId,
        title:
          typeof image.filename === "string" && image.filename.trim()
            ? image.filename
            : normalizedTargetId,
        subtitle:
          typeof image.contentType === "string" && image.contentType.trim()
            ? image.contentType
            : undefined,
        imageURL: image.id,
      };
    }

    if (normalizedType === "message") {
      const message = await getMessageById(normalizedTargetId);
      if (!message) {
        return {
          type: normalizedType,
          id: normalizedTargetId,
          title: normalizedTargetId,
        };
      }

      let title = "Message";
      let subtitle;

      if (typeof message.authorId === "string") {
        const author = await getUserById(message.authorId);
        if (author?.username) {
          const discriminator =
            typeof author.discriminator === "string" &&
            author.discriminator.trim()
              ? `#${author.discriminator}`
              : "";
          title = `${author.username}${discriminator}`;
          subtitle =
            typeof author.displayName === "string" && author.displayName.trim()
              ? author.displayName
              : undefined;

          return {
            type: normalizedType,
            id: normalizedTargetId,
            title,
            subtitle,
            avatar: author.avatar,
          };
        }
      }

      if (typeof message.content === "string" && message.content.trim()) {
        subtitle = trimText(message.content, 240);
      }

      return {
        type: normalizedType,
        id: normalizedTargetId,
        title,
        subtitle,
      };
    }

    return undefined;
  }

  async function applyActionSideEffects({
    actionType,
    targetType,
    targetId,
    actorUserId,
    metadata,
  }) {
    if (targetType === "user") {
      const user = await usersCollection?.findOne({ _id: targetId });
      const currentFlags = typeof user?.flags === "number" ? user.flags : 0;

      if (actionType === "ban") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              flags: currentFlags | USER_FLAG_BANNED,
              "moderation.last_action": "ban",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "unban") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              flags: currentFlags & ~USER_FLAG_BANNED,
              "moderation.last_action": "unban",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "timeout") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              flags: currentFlags | USER_FLAG_SUSPENDED,
              "moderation.timeout_until":
                typeof metadata?.timeoutUntil === "number"
                  ? metadata.timeoutUntil
                  : Date.now() + 24 * 60 * 60 * 1000,
              "moderation.last_action": "timeout",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "untimeout") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              flags: currentFlags & ~USER_FLAG_SUSPENDED,
              "moderation.timeout_until": null,
              "moderation.last_action": "untimeout",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "mute") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              "moderation.muted": true,
              "moderation.last_action": "mute",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "unmute") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              "moderation.muted": false,
              "moderation.last_action": "unmute",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "clear_flags") {
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $set: {
              flags: 0,
              "moderation.timeout_until": null,
              "moderation.muted": false,
              "moderation.last_action": "clear_flags",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      if (actionType === "label_user") {
        const label = trimText(metadata?.label, 80) || "flagged";
        await usersCollection?.updateOne(
          { _id: targetId },
          {
            $addToSet: {
              "moderation.labels": label,
            },
            $set: {
              "moderation.last_action": "label_user",
              "moderation.last_action_at": now(),
              "moderation.last_action_by": actorUserId,
            },
          },
        );
      }

      return;
    }

    if (targetType === "message") {
      if (actionType === "delete_message") {
        const message = await messagesCollection?.findOne({ _id: targetId });
        if (message) {
          await snapshotsCollection?.updateOne(
            { _id: `message:${targetId}` },
            {
              $set: {
                source: "message",
                source_id: targetId,
                snapshot: message,
                updated_at: now(),
              },
            },
            { upsert: true },
          );

          await messagesCollection?.updateOne(
            { _id: targetId },
            {
              $set: {
                content: "[message removed by moderation]",
                moderation_deleted: true,
                moderation_deleted_by: actorUserId,
                moderation_deleted_at: now(),
              },
            },
          );
        }
      }

      if (actionType === "restore_message") {
        const snapshot = await snapshotsCollection?.findOne({
          _id: `message:${targetId}`,
        });
        if (snapshot?.snapshot) {
          await messagesCollection?.replaceOne(
            { _id: targetId },
            snapshot.snapshot,
            { upsert: true },
          );
        }
      }

      return;
    }

    if (targetType === "image" && actionType === "delete_image") {
      await imagesCollection?.updateOne(
        {
          $or: [{ _id: targetId }, { id: targetId }, { file_id: targetId }],
        },
        {
          $set: {
            moderation_removed: true,
            moderation_removed_by: actorUserId,
            moderation_removed_at: now(),
          },
        },
      );
      return;
    }

    if (targetType === "server") {
      if (actionType === "disable_server" || actionType === "delete_server") {
        await serversCollection?.updateOne(
          {
            $or: [{ _id: targetId }, { id: targetId }, { server_id: targetId }],
          },
          {
            $set: {
              moderation_disabled: true,
              moderation_disabled_by: actorUserId,
              moderation_disabled_at: now(),
              moderation_deleted: actionType === "delete_server",
            },
          },
        );
      }
    }
  }

  async function createAction({
    actorUserId,
    actionType,
    targetType,
    targetId,
    reason,
    caseId,
    metadata,
    reportId,
  }) {
    if (!actionsCollection) return undefined;

    const normalizedTargetType = normalizeTargetType(targetType);
    const normalizedTargetId = trimText(targetId, 128);
    const normalizedReason = trimText(reason, 300);

    if (!normalizedTargetType || !normalizedTargetId || !normalizedReason) {
      return undefined;
    }

    const mappedType = ACTION_MAP[actionType] || "note";
    const actionDoc = {
      _id: randomUUID(),
      case_id: trimText(caseId, 128) || undefined,
      reason: normalizedReason,
      type: mappedType,
      user_id: normalizedTargetType === "user" ? normalizedTargetId : undefined,
      target_type: normalizedTargetType,
      target_id: normalizedTargetId,
      created_by: actorUserId,
      created_at: now(),
      action_type: actionType,
      report_id: trimText(reportId, 128) || undefined,
      metadata: metadata && typeof metadata === "object" ? metadata : undefined,
    };

    await actionsCollection.insertOne(actionDoc);

    await applyActionSideEffects({
      actionType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      actorUserId,
      metadata: actionDoc.metadata,
    });

    if (
      normalizedTargetType === "user" &&
      (actionType === "warn" ||
        actionType === "strike" ||
        actionType === "timeout" ||
        actionType === "ban")
    ) {
      await notifyUserAboutModerationAction({
        targetUserId: normalizedTargetId,
        actionType,
        reason: normalizedReason,
        performedBy: actorUserId,
      });
    }

    if (actionDoc.case_id) {
      await casesCollection?.updateOne(
        { _id: actionDoc.case_id },
        {
          $set: { updated_at: now() },
          $push: {
            notes: {
              id: randomUUID(),
              body: `Action applied: ${actionType} on ${normalizedTargetType}:${normalizedTargetId}`,
              author: actorUserId,
              created_at: now(),
            },
          },
        },
      );
    }

    return {
      id: actionDoc._id,
      actionType: actionType,
      targetType: normalizedTargetType,
      targetId: normalizedTargetId,
      reason: normalizedReason,
      caseId: actionDoc.case_id,
      performedBy: actorUserId,
      metadata: actionDoc.metadata,
      createdAt: actionDoc.created_at.getTime(),
    };
  }

  async function listActions({
    targetType,
    targetId,
    caseId,
    query,
    page = 1,
    limit = 100,
    sortDirection = "desc",
  } = {}) {
    if (!actionsCollection) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit: normalizeLimit(limit, 100, 250),
      };
    }

    const findQuery = {};

    const normalizedTargetType = normalizeTargetType(targetType);
    if (normalizedTargetType) {
      findQuery.target_type = normalizedTargetType;
    }

    const normalizedTargetId = trimText(targetId, 128);
    if (normalizedTargetId) {
      findQuery.target_id = normalizedTargetId;
    }

    const normalizedCaseId = trimText(caseId, 128);
    if (normalizedCaseId) {
      findQuery.case_id = normalizedCaseId;
    }

    const normalizedQuery = trimText(query, 128);
    if (normalizedQuery) {
      findQuery.reason = {
        $regex: escapeRegex(normalizedQuery),
        $options: "i",
      };
    }

    const normalizedLimit = normalizeLimit(limit, 100, 250);
    const normalizedPage = normalizePage(page);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const normalizedDirection = normalizeSortDirection(sortDirection);

    const [rows, total] = await Promise.all([
      actionsCollection
        .find(findQuery)
        .sort({ created_at: normalizedDirection })
        .skip(skip)
        .limit(normalizedLimit)
        .toArray(),
      actionsCollection.countDocuments(findQuery),
    ]);

    return {
      items: rows.map((row) => ({
        id: String(row._id),
        actionType:
          typeof row.action_type === "string" ? row.action_type : row.type,
        targetType:
          normalizeTargetType(row.target_type) ??
          (typeof row.user_id === "string" ? "user" : "message"),
        targetId:
          typeof row.target_id === "string"
            ? row.target_id
            : typeof row.user_id === "string"
              ? row.user_id
              : String(row._id),
        reason: typeof row.reason === "string" ? row.reason : "",
        caseId: typeof row.case_id === "string" ? row.case_id : undefined,
        performedBy:
          typeof row.created_by === "string" ? row.created_by : undefined,
        metadata:
          row.metadata && typeof row.metadata === "object"
            ? row.metadata
            : undefined,
        createdAt: toUnixTime(row.created_at) ?? Date.now(),
      })),
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }

  async function searchUsers({
    query,
    page = 1,
    limit = 25,
    sortDirection = "asc",
  } = {}) {
    if (!usersCollection) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit: normalizeLimit(limit, 25, 100),
      };
    }

    const normalizedQuery = trimText(query, 128);
    const matcher = normalizedQuery
      ? { $regex: escapeRegex(normalizedQuery), $options: "i" }
      : undefined;
    const findQuery = normalizedQuery
      ? {
          $or: [
            { _id: normalizedQuery },
            { username: matcher },
            { display_name: matcher },
          ],
        }
      : {};

    const normalizedLimit = normalizeLimit(limit, 25, 100);
    const normalizedPage = normalizePage(page);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const direction = normalizeSortDirection(sortDirection);

    const [rows, total] = await Promise.all([
      usersCollection
        .find(findQuery)
        .project({
          _id: 1,
          username: 1,
          discriminator: 1,
          display_name: 1,
          avatar: 1,
          flags: 1,
          privileged: 1,
        })
        .sort({ username: direction })
        .skip(skip)
        .limit(normalizedLimit)
        .toArray(),
      usersCollection.countDocuments(findQuery),
    ]);

    return {
      items: rows.map((row) => ({
        id: row._id,
        username: row.username,
        discriminator: row.discriminator,
        displayName: row.display_name,
        avatar: row.avatar,
        flags: row.flags,
        privileged: Boolean(row.privileged),
      })),
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }

  async function searchServers({
    query,
    page = 1,
    limit = 25,
    sortDirection = "asc",
  } = {}) {
    if (!serversCollection) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit: normalizeLimit(limit, 25, 100),
      };
    }

    const normalizedQuery = trimText(query, 128);
    const matcher = normalizedQuery
      ? { $regex: escapeRegex(normalizedQuery), $options: "i" }
      : undefined;
    const findQuery = normalizedQuery
      ? {
          $or: [
            { _id: normalizedQuery },
            { name: matcher },
            { description: matcher },
          ],
        }
      : {};

    const normalizedLimit = normalizeLimit(limit, 25, 100);
    const normalizedPage = normalizePage(page);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const direction = normalizeSortDirection(sortDirection);

    const [rows, total] = await Promise.all([
      serversCollection
        .find(findQuery)
        .project({
          _id: 1,
          name: 1,
          description: 1,
          owner: 1,
          icon: 1,
          flags: 1,
        })
        .sort({ name: direction })
        .skip(skip)
        .limit(normalizedLimit)
        .toArray(),
      serversCollection.countDocuments(findQuery),
    ]);

    return {
      items: rows.map((row) => ({
        id: row._id,
        name: row.name,
        description: row.description,
        ownerId: row.owner,
        iconURL: row.icon,
        flags: row.flags,
      })),
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }

  async function searchImages({
    query,
    page = 1,
    limit = 25,
    sortDirection = "desc",
  } = {}) {
    if (!imagesCollection) {
      return {
        items: [],
        total: 0,
        page: 1,
        limit: normalizeLimit(limit, 25, 100),
      };
    }

    const normalizedQuery = trimText(query, 128);
    const matcher = normalizedQuery
      ? { $regex: escapeRegex(normalizedQuery), $options: "i" }
      : undefined;
    const findQuery = normalizedQuery
      ? {
          $or: [
            { _id: normalizedQuery },
            { filename: matcher },
            { uploader_id: normalizedQuery },
            { hash: matcher },
          ],
        }
      : {};

    const normalizedLimit = normalizeLimit(limit, 25, 100);
    const normalizedPage = normalizePage(page);
    const skip = (normalizedPage - 1) * normalizedLimit;
    const direction = normalizeSortDirection(sortDirection);

    const [rows, total] = await Promise.all([
      imagesCollection
        .find(findQuery)
        .project({
          _id: 1,
          filename: 1,
          content_type: 1,
          size: 1,
          uploader_id: 1,
          metadata: 1,
          hash: 1,
          moderation_removed: 1,
          uploaded_at: 1,
        })
        .sort({ uploaded_at: direction })
        .skip(skip)
        .limit(normalizedLimit)
        .toArray(),
      imagesCollection.countDocuments(findQuery),
    ]);

    return {
      items: rows.map((row) => ({
        id: row._id,
        filename: row.filename,
        contentType: row.content_type,
        size: row.size,
        uploaderId: row.uploader_id,
        metadata: row.metadata,
        hash: row.hash,
        removed: Boolean(row.moderation_removed),
        createdAt: toUnixTime(row.uploaded_at),
      })),
      total,
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }

  async function getUserById(userId) {
    if (!usersCollection || !userId) return undefined;

    const row = await usersCollection.findOne(
      { _id: userId },
      {
        projection: {
          _id: 1,
          username: 1,
          discriminator: 1,
          display_name: 1,
          avatar: 1,
          badges: 1,
          flags: 1,
          privileged: 1,
          relations: 1,
          status: 1,
          profile: 1,
          moderation: 1,
        },
      },
    );

    if (!row) return undefined;

    return {
      id: row._id,
      username: row.username,
      discriminator: row.discriminator,
      displayName: row.display_name,
      avatar: row.avatar,
      badges: row.badges,
      flags: row.flags,
      privileged: Boolean(row.privileged),
      relations: row.relations,
      status: row.status,
      profile: row.profile,
      moderation: row.moderation,
    };
  }

  async function getCommentAuthorById(userId) {
    if (!usersCollection || !userId) {
      return undefined;
    }

    const row = await usersCollection.findOne(
      { _id: userId },
      {
        projection: {
          _id: 1,
          username: 1,
        },
      },
    );

    if (!row || typeof row.username !== "string" || !row.username.trim()) {
      return undefined;
    }

    return {
      id: row._id,
      username: row.username,
    };
  }

  async function buildCommentAuthorUsernameMap(authorIds) {
    if (
      !usersCollection ||
      !Array.isArray(authorIds) ||
      authorIds.length === 0
    ) {
      return new Map();
    }

    const uniqueAuthorIds = [...new Set(authorIds.filter(Boolean))];
    if (uniqueAuthorIds.length === 0) {
      return new Map();
    }

    const rows = await usersCollection
      .find(
        { _id: { $in: uniqueAuthorIds } },
        {
          projection: {
            _id: 1,
            username: 1,
          },
        },
      )
      .toArray();

    const authorMap = new Map();
    for (const row of rows) {
      if (typeof row?._id !== "string") {
        continue;
      }

      const username =
        typeof row.username === "string" && row.username.trim()
          ? row.username
          : undefined;

      if (username) {
        authorMap.set(row._id, username);
      }
    }

    return authorMap;
  }

  async function updateUserModerationProfile(userId, payload, actorUserId) {
    if (
      !usersCollection ||
      !userId ||
      !payload ||
      typeof payload !== "object"
    ) {
      return undefined;
    }

    const $set = {
      "moderation.last_profile_action_at": now(),
      "moderation.last_profile_action_by": actorUserId,
    };
    const $unset = {};

    const nextUsername = trimText(payload.username, 32).toLowerCase();
    if (nextUsername) {
      $set.username = nextUsername;
    }

    const nextDisplayName = trimText(payload.displayName, 32);
    if (nextDisplayName) {
      $set.display_name = nextDisplayName;
    }

    if (payload.removeDisplayName === true) {
      $unset.display_name = "";
    }

    const nextBio = trimText(payload.bio, 500);
    if (nextBio) {
      $set["profile.content"] = nextBio;
    }

    if (payload.removeBio === true) {
      $unset["profile.content"] = "";
    }

    if (payload.removeAvatar === true) {
      $unset.avatar = "";
    }

    if (payload.removeBanner === true) {
      $unset["profile.background"] = "";
    }

    const nextBadges = toBitfield(payload.badges);
    if (typeof nextBadges === "number") {
      $set.badges = nextBadges;
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return getUserById(userId);
    }

    const updateDoc = {};
    if (Object.keys($set).length > 0) {
      updateDoc.$set = $set;
    }
    if (Object.keys($unset).length > 0) {
      updateDoc.$unset = $unset;
    }

    await usersCollection.updateOne({ _id: userId }, updateDoc);
    return getUserById(userId);
  }

  async function listUserComments(userId, { limit = 100 } = {}) {
    if (!userCommentsCollection || !userId) {
      return [];
    }

    const normalizedLimit = normalizeLimit(limit, 100, 250);
    const rows = await userCommentsCollection
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(normalizedLimit)
      .toArray();

    const authorMap = await buildCommentAuthorUsernameMap(
      rows
        .map((row) =>
          typeof row.author_id === "string" ? row.author_id : undefined,
        )
        .filter(Boolean),
    );

    return rows.map((row) => ({
      id: String(row._id),
      userId: row.user_id,
      body: typeof row.body === "string" ? row.body : "",
      attachments: normalizeCommentAttachments(row.attachments),
      embeds: normalizeCommentEmbeds(row.embeds),
      authorId: typeof row.author_id === "string" ? row.author_id : undefined,
      authorUsername:
        typeof row.author_id === "string"
          ? authorMap.get(row.author_id)
          : undefined,
      createdAt: toUnixTime(row.created_at) ?? Date.now(),
      updatedAt: toUnixTime(row.updated_at),
    }));
  }

  async function addUserComment(
    userId,
    actorUserId,
    body,
    { attachments, embeds } = {},
  ) {
    if (!userCommentsCollection || !userId || !actorUserId) {
      return undefined;
    }

    const normalizedBody = trimText(body, 3000);
    if (!normalizedBody) {
      return undefined;
    }

    const createdAt = now();
    const normalizedAttachments = normalizeCommentAttachments(attachments, {
      assignIds: true,
    });
    const normalizedEmbeds = normalizeCommentEmbeds(embeds, {
      assignIds: true,
    });
    const doc = {
      _id: randomUUID(),
      user_id: userId,
      author_id: actorUserId,
      body: normalizedBody,
      attachments: normalizedAttachments,
      embeds: normalizedEmbeds,
      created_at: createdAt,
      updated_at: createdAt,
    };

    await userCommentsCollection.insertOne(doc);

    const author = await getCommentAuthorById(actorUserId);

    return {
      id: doc._id,
      userId: doc.user_id,
      body: doc.body,
      attachments: doc.attachments,
      embeds: doc.embeds,
      authorId: doc.author_id,
      authorUsername: author?.username,
      createdAt: createdAt.getTime(),
      updatedAt: createdAt.getTime(),
    };
  }

  async function getServerById(serverId) {
    if (!serversCollection || !serverId) return undefined;

    const row = await serversCollection.findOne(
      { _id: serverId },
      {
        projection: {
          _id: 1,
          name: 1,
          description: 1,
          owner: 1,
          channels: 1,
          categories: 1,
          icon: 1,
          banner: 1,
          flags: 1,
          moderation_disabled: 1,
          moderation_disabled_by: 1,
          moderation_disabled_at: 1,
        },
      },
    );

    if (!row) return undefined;

    return {
      id: row._id,
      name: row.name,
      description: row.description,
      ownerId: row.owner,
      channelCount: Array.isArray(row.channels)
        ? row.channels.length
        : undefined,
      categoryCount: Array.isArray(row.categories)
        ? row.categories.length
        : undefined,
      iconURL: row.icon,
      banner: row.banner,
      flags: row.flags,
      moderationDisabled: Boolean(row.moderation_disabled),
      moderationDisabledBy: row.moderation_disabled_by,
      moderationDisabledAt: toUnixTime(row.moderation_disabled_at),
    };
  }

  async function updateServerModerationProfile(serverId, payload, actorUserId) {
    if (
      !serversCollection ||
      !serverId ||
      !payload ||
      typeof payload !== "object"
    ) {
      return undefined;
    }

    const $set = {
      "moderation.last_profile_action_at": now(),
      "moderation.last_profile_action_by": actorUserId,
    };
    const $unset = {};

    const nextName = trimText(payload.name, 64);
    if (nextName) {
      $set.name = nextName;
    }

    const nextDescription = trimText(payload.description, 1000);
    if (nextDescription) {
      $set.description = nextDescription;
    }

    const nextFlags = toBitfield(payload.flags);
    if (typeof nextFlags === "number") {
      $set.flags = nextFlags;
    }

    if (typeof payload.moderationDisabled === "boolean") {
      $set.moderation_disabled = payload.moderationDisabled;

      if (payload.moderationDisabled) {
        $set.moderation_disabled_by = actorUserId;
        $set.moderation_disabled_at = now();
      } else {
        $unset.moderation_disabled_by = "";
        $unset.moderation_disabled_at = "";
      }
    }

    if (payload.removeDescription === true) {
      $unset.description = "";
    }

    if (payload.removeIcon === true) {
      $unset.icon = "";
    }

    if (payload.removeBanner === true) {
      $unset.banner = "";
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return getServerById(serverId);
    }

    const updateDoc = {};
    if (Object.keys($set).length > 0) {
      updateDoc.$set = $set;
    }
    if (Object.keys($unset).length > 0) {
      updateDoc.$unset = $unset;
    }

    await serversCollection.updateOne({ _id: serverId }, updateDoc);
    return getServerById(serverId);
  }

  async function listServerComments(serverId, { limit = 100 } = {}) {
    if (!serverCommentsCollection || !serverId) {
      return [];
    }

    const normalizedLimit = normalizeLimit(limit, 100, 250);
    const rows = await serverCommentsCollection
      .find({ server_id: serverId })
      .sort({ created_at: -1 })
      .limit(normalizedLimit)
      .toArray();

    const authorMap = await buildCommentAuthorUsernameMap(
      rows
        .map((row) =>
          typeof row.author_id === "string" ? row.author_id : undefined,
        )
        .filter(Boolean),
    );

    return rows.map((row) => ({
      id: String(row._id),
      serverId: row.server_id,
      body: typeof row.body === "string" ? row.body : "",
      attachments: normalizeCommentAttachments(row.attachments),
      embeds: normalizeCommentEmbeds(row.embeds),
      authorId: typeof row.author_id === "string" ? row.author_id : undefined,
      authorUsername:
        typeof row.author_id === "string"
          ? authorMap.get(row.author_id)
          : undefined,
      createdAt: toUnixTime(row.created_at) ?? Date.now(),
      updatedAt: toUnixTime(row.updated_at),
    }));
  }

  async function addServerComment(
    serverId,
    actorUserId,
    body,
    { attachments, embeds } = {},
  ) {
    if (!serverCommentsCollection || !serverId || !actorUserId) {
      return undefined;
    }

    const normalizedBody = trimText(body, 3000);
    if (!normalizedBody) {
      return undefined;
    }

    const createdAt = now();
    const normalizedAttachments = normalizeCommentAttachments(attachments, {
      assignIds: true,
    });
    const normalizedEmbeds = normalizeCommentEmbeds(embeds, {
      assignIds: true,
    });
    const doc = {
      _id: randomUUID(),
      server_id: serverId,
      author_id: actorUserId,
      body: normalizedBody,
      attachments: normalizedAttachments,
      embeds: normalizedEmbeds,
      created_at: createdAt,
      updated_at: createdAt,
    };

    await serverCommentsCollection.insertOne(doc);

    const author = await getCommentAuthorById(actorUserId);

    return {
      id: doc._id,
      serverId: doc.server_id,
      body: doc.body,
      attachments: doc.attachments,
      embeds: doc.embeds,
      authorId: doc.author_id,
      authorUsername: author?.username,
      createdAt: createdAt.getTime(),
      updatedAt: createdAt.getTime(),
    };
  }

  async function listImageComments(imageId, { limit = 100 } = {}) {
    if (!imageCommentsCollection || !imageId) {
      return [];
    }

    const normalizedLimit = normalizeLimit(limit, 100, 250);
    const rows = await imageCommentsCollection
      .find({ image_id: imageId })
      .sort({ created_at: -1 })
      .limit(normalizedLimit)
      .toArray();

    const authorMap = await buildCommentAuthorUsernameMap(
      rows
        .map((row) =>
          typeof row.author_id === "string" ? row.author_id : undefined,
        )
        .filter(Boolean),
    );

    return rows.map((row) => ({
      id: String(row._id),
      imageId: row.image_id,
      body: typeof row.body === "string" ? row.body : "",
      attachments: normalizeCommentAttachments(row.attachments),
      embeds: normalizeCommentEmbeds(row.embeds),
      authorId: typeof row.author_id === "string" ? row.author_id : undefined,
      authorUsername:
        typeof row.author_id === "string"
          ? authorMap.get(row.author_id)
          : undefined,
      createdAt: toUnixTime(row.created_at) ?? Date.now(),
      updatedAt: toUnixTime(row.updated_at),
    }));
  }

  async function addImageComment(
    imageId,
    actorUserId,
    body,
    { attachments, embeds } = {},
  ) {
    if (!imageCommentsCollection || !imageId || !actorUserId) {
      return undefined;
    }

    const normalizedBody = trimText(body, 3000);
    if (!normalizedBody) {
      return undefined;
    }

    const createdAt = now();
    const normalizedAttachments = normalizeCommentAttachments(attachments, {
      assignIds: true,
    });
    const normalizedEmbeds = normalizeCommentEmbeds(embeds, {
      assignIds: true,
    });
    const doc = {
      _id: randomUUID(),
      image_id: imageId,
      author_id: actorUserId,
      body: normalizedBody,
      attachments: normalizedAttachments,
      embeds: normalizedEmbeds,
      created_at: createdAt,
      updated_at: createdAt,
    };

    await imageCommentsCollection.insertOne(doc);

    const author = await getCommentAuthorById(actorUserId);

    return {
      id: doc._id,
      imageId: doc.image_id,
      body: doc.body,
      attachments: doc.attachments,
      embeds: doc.embeds,
      authorId: doc.author_id,
      authorUsername: author?.username,
      createdAt: createdAt.getTime(),
      updatedAt: createdAt.getTime(),
    };
  }

  async function getImageById(imageId) {
    if (!imagesCollection || !imageId) return undefined;

    const row = await imagesCollection.findOne(
      { _id: imageId },
      {
        projection: {
          _id: 1,
          filename: 1,
          content_type: 1,
          size: 1,
          uploader_id: 1,
          hash: 1,
          metadata: 1,
          uploaded_at: 1,
          used_for: 1,
          moderation_removed: 1,
          moderation_removed_by: 1,
          moderation_removed_at: 1,
        },
      },
    );

    if (!row) return undefined;

    return {
      id: row._id,
      filename: row.filename,
      contentType: row.content_type,
      size: row.size,
      uploaderId: row.uploader_id,
      hash: row.hash,
      metadata: row.metadata,
      createdAt: toUnixTime(row.uploaded_at),
      usedFor: row.used_for,
      removed: Boolean(row.moderation_removed),
      removedBy: row.moderation_removed_by,
      removedAt: toUnixTime(row.moderation_removed_at),
    };
  }

  function normalizeActionLabel(actionType) {
    if (actionType === "warn") return "Warning";
    if (actionType === "strike") return "Strike";
    if (actionType === "timeout") return "Suspension";
    if (actionType === "ban") return "Ban";
    return "Moderation Action";
  }

  function buildSystemMessageBody({ actionType, reason }) {
    const label = normalizeActionLabel(actionType);
    const safeReason = reason || "No reason provided.";

    return [
      `Hello, this is an automated moderation notice from system#0000.`,
      `Action: ${label}`,
      `Reason: ${safeReason}`,
      `If you believe this was a mistake, please contact support.`,
    ].join("\n");
  }

  async function sendModerationEmailNotice({
    email,
    username,
    actionType,
    reason,
    targetUserId,
    performedBy,
  }) {
    const webhookUrl = trimText(notificationEmailWebhookUrl, 2000);
    if (!webhookUrl || !email) {
      return;
    }

    try {
      await globalThis.fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "moderation-user-action",
          userId: targetUserId,
          to: email,
          username,
          actionType,
          actionLabel: normalizeActionLabel(actionType),
          reason,
          performedBy,
          createdAt: Date.now(),
        }),
      });
    } catch (error) {
      logger.warn("[moderation] failed to send moderation email notice", error);
    }
  }

  async function sendModerationDmNotice({ targetUserId, actionType, reason }) {
    const systemToken = trimText(notificationSystemSessionToken, 2000);
    if (!systemToken || !targetUserId) {
      return;
    }

    try {
      const dmResponse = await globalThis.fetch(
        `${notificationApiBase}/users/${encodeURIComponent(targetUserId)}/dm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-token": systemToken,
            authorization: `Bearer ${systemToken}`,
          },
        },
      );

      if (!dmResponse.ok) {
        return;
      }

      let dmPayload;
      try {
        dmPayload = await dmResponse.json();
      } catch {
        return;
      }

      const channelId =
        typeof dmPayload?._id === "string"
          ? dmPayload._id
          : typeof dmPayload?.channel_id === "string"
            ? dmPayload.channel_id
            : undefined;

      if (!channelId) {
        return;
      }

      await globalThis.fetch(
        `${notificationApiBase}/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-session-token": systemToken,
            authorization: `Bearer ${systemToken}`,
          },
          body: JSON.stringify({
            content: buildSystemMessageBody({ actionType, reason }),
          }),
        },
      );
    } catch (error) {
      logger.warn("[moderation] failed to send moderation DM notice", error);
    }
  }

  async function notifyUserAboutModerationAction({
    targetUserId,
    actionType,
    reason,
    performedBy,
  }) {
    if (!usersCollection || !targetUserId) {
      return;
    }

    const user = await usersCollection.findOne(
      { _id: targetUserId },
      {
        projection: {
          _id: 1,
          username: 1,
          email: 1,
        },
      },
    );

    const username =
      typeof user?.username === "string" ? user.username : undefined;
    const email = typeof user?.email === "string" ? user.email : undefined;

    await Promise.allSettled([
      sendModerationEmailNotice({
        email,
        username,
        actionType,
        reason,
        targetUserId,
        performedBy,
      }),
      sendModerationDmNotice({
        targetUserId,
        actionType,
        reason,
      }),
    ]);
  }

  async function close() {
    await client?.close();
  }

  return {
    connect,
    getPermissionsForUser,
    listModerators,
    upsertModerator,
    removeModerator,
    listReports,
    getReportById,
    createReport,
    updateReportStatus,
    listCases,
    createCase,
    getCaseById,
    updateCaseStatus,
    createAction,
    listActions,
    searchUsers,
    searchServers,
    searchImages,
    getUserById,
    updateUserModerationProfile,
    listUserComments,
    addUserComment,
    getServerById,
    updateServerModerationProfile,
    listServerComments,
    addServerComment,
    listImageComments,
    addImageComment,
    getImageById,
    getMessageById,
    close,
  };
}
