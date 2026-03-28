import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { clearInterval, setInterval, setTimeout } from "node:timers";
import { URL, fileURLToPath } from "node:url";

import * as Sentry from "@sentry/node";
import dotenv from "dotenv";
import express from "express";
import { WebSocketServer } from "ws";

import { createCallStateStore } from "./callStateStore.mjs";
import { createModerationStore } from "./moderationStore.mjs";
import { createNotificationSettingsStore } from "./notificationSettingsStore.mjs";
import { createPresenceStream } from "./presenceStream.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function resolveDistDir() {
  const configuredDist = process.env.CLIENT_DIST_DIR;
  const candidates = [
    configuredDist
      ? path.isAbsolute(configuredDist)
        ? configuredDist
        : path.resolve(rootDir, configuredDist)
      : null,
    path.resolve(rootDir, "packages/client/dist"),
    path.resolve(process.cwd(), "packages/client/dist"),
    path.resolve(process.cwd(), "client/packages/client/dist"),
    path.resolve(rootDir, "../packages/client/dist"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.existsSync(path.resolve(candidate, "index.html"))
    ) {
      return candidate;
    }
  }

  return path.resolve(rootDir, "packages/client/dist");
}

const distDir = resolveDistDir();

dotenv.config({ path: path.resolve(rootDir, ".env") });

const HARD_CODED_SENTRY_DSN =
  "https://82ee7c93f5675dc1c4bbb122807eea64@o4508026382712832.ingest.us.sentry.io/4511091575095296";

Sentry.init({
  dsn: HARD_CODED_SENTRY_DSN,
  release: `dawnchat-server@${process.env.npm_package_version || "dev"}`,
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  normalizeDepth: 6,
});

function captureServerError(error, context, extras) {
  Sentry.captureException(error, {
    tags: {
      context,
      runtime: "server",
    },
    extra: extras,
  });
}

const envPort = Number(process.env.SERVER_PORT);
const port = Number.isInteger(envPort) && envPort > 0 ? envPort : 5000;
const clientApiSocketPath =
  process.env.CLIENT_API_WS_PATH || "/client-api/socket";
const legacyPresenceSocketPath = process.env.PRESENCE_WS_PATH || "/presence";
const moderationAuthApiBase =
  process.env.MODERATION_AUTH_API_BASE || "https://api.revolt.chat";
const moderationSuperuserIds = new Set(
  String(process.env.MODERATION_SUPERUSER_IDS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const moderationAuthCache = new Map();
const hardcodedDefaultAdmin = Object.freeze({
  username: "fttristan",
  discriminator: "0000",
  email: "tristanhomes1000@gmail.com",
});
const ownerScopes = Object.freeze({
  viewPanel: true,
  manageModerators: true,
  moderateUsers: true,
  moderateMessages: true,
  moderateServers: true,
  moderateImages: true,
  manageCases: true,
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

const clientApiCorsAllowedOrigins = new Set(
  String(
    process.env.CLIENT_API_ALLOWED_ORIGINS ||
      "tauri://localhost,https://app.dawn-chat.com,http://localhost,http://127.0.0.1",
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

function applyClientApiCorsHeaders(req, res) {
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";

  if (origin && clientApiCorsAllowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  );

  const requestHeaders =
    typeof req.headers["access-control-request-headers"] === "string"
      ? req.headers["access-control-request-headers"]
      : "";

  res.setHeader(
    "Access-Control-Allow-Headers",
    requestHeaders ||
      [
        "content-type",
        "authorization",
        "x-session-token",
        "x-user-id",
        "x-client-session-token",
        "x-client-user-id",
      ].join(", "),
  );

  res.setHeader("Access-Control-Max-Age", "86400");
}

app.use("/client-api", (req, res, next) => {
  applyClientApiCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

function isValidCallStatus(status) {
  return (
    status === "Ringing" ||
    status === "Active" ||
    status === "Missed" ||
    status === "Ended"
  );
}

function normalizeCallStatePayload(payload) {
  if (!payload || typeof payload !== "object") return undefined;

  const channelId =
    typeof payload.channelId === "string" ? payload.channelId.trim() : "";
  const callId =
    typeof payload.callId === "string" ? payload.callId.trim() : "";
  const status = payload.status;
  const startedById =
    typeof payload.startedById === "string" ? payload.startedById.trim() : "";
  const updatedById =
    typeof payload.updatedById === "string" ? payload.updatedById.trim() : "";
  const channelType =
    payload.channelType === "DirectMessage" || payload.channelType === "Group"
      ? payload.channelType
      : undefined;
  const rawUpdatedAt =
    typeof payload.updatedAt === "number"
      ? payload.updatedAt
      : typeof payload.clientUpdatedAt === "number"
        ? payload.clientUpdatedAt
        : Date.now();
  const now = Date.now();
  const updatedAt =
    Number.isFinite(rawUpdatedAt) &&
    rawUpdatedAt > now - 10 * 60_000 &&
    rawUpdatedAt < now + 60_000
      ? rawUpdatedAt
      : now;

  if (!channelId || !callId || !isValidCallStatus(status)) return undefined;
  if (status === "Ringing" && !channelType) return undefined;

  return {
    channelId,
    callId,
    status,
    updatedAt,
    startedById: startedById || undefined,
    updatedById: updatedById || undefined,
    channelType,
  };
}

function moderationAuthCacheKey(sessionToken) {
  return `session:${sessionToken}`;
}

async function resolveAuthenticatedUser(sessionToken) {
  if (!sessionToken) return undefined;

  const key = moderationAuthCacheKey(sessionToken);
  const cached = moderationAuthCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const response = await globalThis.fetch(
    `${moderationAuthApiBase}/users/@me`,
    {
      headers: {
        "x-session-token": sessionToken,
        authorization: `Bearer ${sessionToken}`,
      },
    },
  );

  if (!response.ok) {
    return undefined;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return undefined;
  }

  const userId =
    typeof payload?._id === "string"
      ? payload._id
      : typeof payload?.id === "string"
        ? payload.id
        : undefined;

  if (!userId) return undefined;

  const user = {
    userId,
    username:
      typeof payload?.username === "string"
        ? payload.username.toLowerCase()
        : undefined,
    discriminator:
      typeof payload?.discriminator === "string"
        ? payload.discriminator
        : undefined,
    email:
      typeof payload?.email === "string"
        ? payload.email.toLowerCase()
        : undefined,
  };

  moderationAuthCache.set(key, {
    user,
    expiresAt: Date.now() + 60_000,
  });

  return user;
}

function isHardcodedDefaultAdmin(user) {
  if (!user) return false;

  const usernameMatches =
    user.username === hardcodedDefaultAdmin.username &&
    user.discriminator === hardcodedDefaultAdmin.discriminator;
  const emailMatches = user.email === hardcodedDefaultAdmin.email;

  return usernameMatches || emailMatches;
}

async function authenticateModerationRequest(req, res, next) {
  const requestedUserId =
    typeof req.headers["x-client-user-id"] === "string"
      ? req.headers["x-client-user-id"].trim()
      : "";
  const sessionToken =
    typeof req.headers["x-client-session-token"] === "string"
      ? req.headers["x-client-session-token"].trim()
      : "";

  if (!requestedUserId || !sessionToken) {
    res.status(401).json({
      error: "Missing moderation authentication headers",
    });
    return;
  }

  try {
    const authenticatedUser = await resolveAuthenticatedUser(sessionToken);
    if (!authenticatedUser?.userId) {
      res.status(401).json({ error: "Invalid moderation session" });
      return;
    }

    if (authenticatedUser.userId !== requestedUserId) {
      res.status(403).json({ error: "Session/user mismatch" });
      return;
    }

    req.moderationActor = {
      userId: authenticatedUser.userId,
      isHardcodedAdmin: isHardcodedDefaultAdmin(authenticatedUser),
    };
    next();
  } catch (error) {
    console.error("[moderation] authentication failure", error);
    res.status(500).json({ error: "Moderation authentication failed" });
  }
}

async function requireModerationScope(req, res, next, scope) {
  const actorUserId = req?.moderationActor?.userId;
  if (!actorUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    if (req.moderationActor?.isHardcodedAdmin) {
      req.moderationPermissions = {
        role: "owner",
        scopes: ownerScopes,
      };
      next();
      return;
    }

    const permissions =
      await moderationStore.getPermissionsForUser(actorUserId);
    if (!permissions?.scopes?.[scope]) {
      res.status(403).json({ error: "Missing moderation permission" });
      return;
    }

    req.moderationPermissions = permissions;
    next();
  } catch (error) {
    console.error("[moderation] permission check failed", error);
    res.status(500).json({ error: "Failed to evaluate moderation permission" });
  }
}

function requireScope(scope) {
  return async (req, res, next) =>
    requireModerationScope(req, res, next, scope);
}

function scopeForTargetType(targetType) {
  if (targetType === "user") return "moderateUsers";
  if (targetType === "message") return "moderateMessages";
  if (targetType === "server") return "moderateServers";
  if (targetType === "image") return "moderateImages";
  return undefined;
}

const moderationRoutePaths = Object.freeze({
  bootstrap: [
    "/client-api/moderation/bootstrap",
    "/client-api/moderation/legacy/bootstrap",
  ],
  moderators: [
    "/client-api/moderation/moderators",
    "/client-api/moderation/legacy/moderators",
  ],
  moderatorsUser: [
    "/client-api/moderation/moderators/:userId",
    "/client-api/moderation/legacy/moderators/:userId",
  ],
  cases: [
    "/client-api/moderation/cases",
    "/client-api/moderation/legacy/cases",
  ],
  reports: [
    "/client-api/moderation/reports",
    "/client-api/moderation/legacy/reports",
  ],
  reportById: [
    "/client-api/moderation/reports/:reportId",
    "/client-api/moderation/legacy/reports/:reportId",
  ],
  reportStatus: [
    "/client-api/moderation/reports/:reportId/status",
    "/client-api/moderation/legacy/reports/:reportId/status",
  ],
  actions: [
    "/client-api/moderation/actions",
    "/client-api/moderation/legacy/actions",
  ],
  bulkActions: [
    "/client-api/moderation/actions/bulk",
    "/client-api/moderation/legacy/actions/bulk",
  ],
  searchUsers: [
    "/client-api/moderation/search/users",
    "/client-api/moderation/legacy/search/users",
  ],
  searchServers: [
    "/client-api/moderation/search/servers",
    "/client-api/moderation/legacy/search/servers",
  ],
  searchImages: [
    "/client-api/moderation/search/images",
    "/client-api/moderation/legacy/search/images",
  ],
  viewUser: [
    "/client-api/moderation/view/users/:userId",
    "/client-api/moderation/legacy/view/users/:userId",
  ],
  userComments: [
    "/client-api/moderation/view/users/:userId/comments",
    "/client-api/moderation/legacy/view/users/:userId/comments",
  ],
  viewServer: [
    "/client-api/moderation/view/servers/:serverId",
    "/client-api/moderation/legacy/view/servers/:serverId",
  ],
  serverComments: [
    "/client-api/moderation/view/servers/:serverId/comments",
    "/client-api/moderation/legacy/view/servers/:serverId/comments",
  ],
  viewImage: [
    "/client-api/moderation/view/images/:imageId",
    "/client-api/moderation/legacy/view/images/:imageId",
  ],
  imageComments: [
    "/client-api/moderation/view/images/:imageId/comments",
    "/client-api/moderation/legacy/view/images/:imageId/comments",
  ],
  caseStatus: [
    "/client-api/moderation/cases/:caseId/status",
    "/client-api/moderation/legacy/cases/:caseId/status",
  ],
});

function sendTypedSocketMessage(socket, message) {
  socket.send(JSON.stringify(message));
}

function broadcastTypedSocketMessage(clients, message) {
  const encoded = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(encoded);
    }
  }
}

function htmlPage({ title, heading, message, statusCode }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        background: radial-gradient(circle at top, #f3f5f8 0%, #e7ecf4 40%, #dde4ef 100%);
        color: #1f2937;
      }
      .card {
        width: min(92vw, 640px);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid #d8dfeb;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);
        padding: 28px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(1.4rem, 2.6vw, 2rem);
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #3f4b5f;
      }
      .status {
        margin-top: 16px;
        font-size: 0.9rem;
        color: #607089;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${heading}</h1>
      <p>${message}</p>
      <p class="status">HTTP ${statusCode}</p>
    </main>
  </body>
</html>`;
}

function sendErrorPage(res, statusCode, heading, message) {
  res
    .status(statusCode)
    .type("html")
    .send(
      htmlPage({
        title: `${statusCode} ${heading}`,
        heading,
        message,
        statusCode,
      }),
    );
}

if (!fs.existsSync(distDir)) {
  console.error(`[server] build output not found: ${distDir}`);
  console.error("[server] run `npm run build` before `npm run start`");
  process.exit(1);
}

app.use((req, res, next) => {
  if (req.path.endsWith(".map")) {
    sendErrorPage(
      res,
      404,
      "Not Found",
      "This resource is not available on this server.",
    );
    return;
  }

  next();
});

app.use(
  express.static(distDir, {
    index: false,
    fallthrough: true,
    etag: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      const relativePath = path
        .relative(distDir, filePath)
        .replaceAll("\\", "/");

      if (
        relativePath === "index.html" ||
        relativePath === "serviceWorker.js" ||
        relativePath === "serviceWorker.js.map"
      ) {
        res.setHeader("Cache-Control", "no-store, must-revalidate");
        return;
      }

      if (relativePath.startsWith("assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return;
      }

      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  }),
);

app.get("/client-api/dm-ringing", async (req, res) => {
  const channelId =
    typeof req.query.channelId === "string" ? req.query.channelId.trim() : "";
  const callId =
    typeof req.query.callId === "string" ? req.query.callId.trim() : "";

  if (!channelId) {
    res.status(400).json({ error: "channelId is required" });
    return;
  }

  try {
    if (callId) {
      const item = await callStateStore.getOne(channelId, callId);
      res.json({ item: item ?? null });
      return;
    }

    const items = await callStateStore.getByChannel(channelId);
    res.json({ items });
  } catch (error) {
    console.error("[client-api] failed to load dm-ringing state", error);
    res.status(500).json({ error: "Failed to load call state" });
  }
});

app.post("/client-api/dm-ringing", async (req, res) => {
  const payload = normalizeCallStatePayload(req.body);

  if (!payload) {
    res.status(400).json({
      error: "Invalid payload. Expected channelId, callId and status.",
    });
    return;
  }

  try {
    const persisted = await callStateStore.upsert(payload);
    if (!persisted?.item) {
      res.status(503).json({ error: "Call state store is unavailable" });
      return;
    }

    if (persisted.changed) {
      broadcastTypedSocketMessage(clientApiWsClients, {
        type: "dm-ringing:update",
        data: persisted.item,
      });
    }

    res.json({ ok: true, item: persisted.item, changed: persisted.changed });
  } catch (error) {
    console.error("[client-api] failed to persist dm-ringing state", error);
    res.status(500).json({ error: "Failed to persist call state" });
  }
});

app.get("/client-api/notification-settings", async (req, res) => {
  const userId =
    typeof req.query.userId === "string" ? req.query.userId.trim() : "";

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const item = await notificationSettingsStore.getByUserId(userId);
    res.json({ item: item ?? null });
  } catch (error) {
    console.error("[client-api] failed to load notification settings", error);
    res.status(500).json({ error: "Failed to load notification settings" });
  }
});

app.post("/client-api/notification-settings", async (req, res) => {
  const userId =
    typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const item = await notificationSettingsStore.upsertByUserId(
      userId,
      req.body?.settings,
    );

    if (!item) {
      res
        .status(503)
        .json({ error: "Notification settings store unavailable" });
      return;
    }

    res.json({ ok: true, item });
  } catch (error) {
    console.error("[client-api] failed to save notification settings", error);
    res.status(500).json({ error: "Failed to save notification settings" });
  }
});

app.get(
  moderationRoutePaths.bootstrap,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    res.json({
      item: {
        userId: req.moderationActor.userId,
        role: req.moderationPermissions.role,
        scopes: req.moderationPermissions.scopes,
      },
    });
  },
);

app.get(
  moderationRoutePaths.moderators,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (_req, res) => {
    try {
      const items = await moderationStore.listModerators();
      res.json({ items });
    } catch (error) {
      console.error("[moderation] failed to list moderators", error);
      res.status(500).json({ error: "Failed to list moderators" });
    }
  },
);

app.post(
  moderationRoutePaths.moderators,
  authenticateModerationRequest,
  requireScope("manageModerators"),
  async (req, res) => {
    const userId =
      typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      const item = await moderationStore.upsertModerator(
        req.moderationActor.userId,
        {
          userId,
          role: req.body?.role,
          scopes: req.body?.scopes,
        },
      );

      if (!item) {
        res.status(400).json({ error: "Invalid moderator payload" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to upsert moderator", error);
      res.status(500).json({ error: "Failed to upsert moderator" });
    }
  },
);

app.delete(
  moderationRoutePaths.moderatorsUser,
  authenticateModerationRequest,
  requireScope("manageModerators"),
  async (req, res) => {
    const userId =
      typeof req.params?.userId === "string" ? req.params.userId.trim() : "";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      const ok = await moderationStore.removeModerator(userId);
      if (!ok) {
        res.status(400).json({ error: "Cannot remove this moderator" });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("[moderation] failed to remove moderator", error);
      res.status(500).json({ error: "Failed to remove moderator" });
    }
  },
);

app.get(
  moderationRoutePaths.cases,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    try {
      const payload = await moderationStore.listCases({
        targetType: req.query?.targetType,
        targetId: req.query?.targetId,
        status: req.query?.status,
        query: req.query?.query,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        sortDirection: req.query?.sortDirection,
      });

      res.json(payload);
    } catch (error) {
      console.error("[moderation] failed to list cases", error);
      res.status(500).json({ error: "Failed to list moderation cases" });
    }
  },
);

app.get(
  moderationRoutePaths.reports,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    try {
      const payload = await moderationStore.listReports({
        status: req.query?.status,
        targetType: req.query?.targetType,
        targetId: req.query?.targetId,
        query: req.query?.query,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        sortDirection: req.query?.sortDirection,
      });

      res.json(payload);
    } catch (error) {
      console.error("[moderation] failed to list reports", error);
      res.status(500).json({ error: "Failed to list moderation reports" });
    }
  },
);

app.get(
  moderationRoutePaths.reportById,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    const reportId =
      typeof req.params?.reportId === "string"
        ? req.params.reportId.trim()
        : "";

    if (!reportId) {
      res.status(400).json({ error: "reportId is required" });
      return;
    }

    try {
      const item = await moderationStore.getReportById(reportId);
      if (!item) {
        res.status(404).json({ error: "Report not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to load report details", error);
      res.status(500).json({ error: "Failed to load report details" });
    }
  },
);

app.post(
  moderationRoutePaths.reports,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    const targetType =
      typeof req.body?.targetType === "string"
        ? req.body.targetType.trim()
        : "";
    const targetId =
      typeof req.body?.targetId === "string" ? req.body.targetId.trim() : "";

    if (!targetType || !targetId) {
      res.status(400).json({ error: "targetType and targetId are required" });
      return;
    }

    const requiredScope = scopeForTargetType(targetType);
    if (!requiredScope || !req.moderationPermissions.scopes[requiredScope]) {
      res
        .status(403)
        .json({ error: "Missing moderation permission for target" });
      return;
    }

    try {
      const item = await moderationStore.createReport({
        actorUserId: req.moderationActor.userId,
        targetType,
        targetId,
        reportReason: req.body?.reportReason,
        additionalContext: req.body?.additionalContext,
        autoCreateCase: req.body?.autoCreateCase !== false,
      });

      if (!item) {
        res.status(400).json({ error: "Invalid report payload" });
        return;
      }

      res.status(201).json({ item });
    } catch (error) {
      console.error("[moderation] failed to create report", error);
      res.status(500).json({ error: "Failed to create moderation report" });
    }
  },
);

app.patch(
  moderationRoutePaths.reportStatus,
  authenticateModerationRequest,
  requireScope("manageCases"),
  async (req, res) => {
    const reportId =
      typeof req.params?.reportId === "string"
        ? req.params.reportId.trim()
        : "";

    if (!reportId) {
      res.status(400).json({ error: "reportId is required" });
      return;
    }

    try {
      const item = await moderationStore.updateReportStatus({
        reportId,
        status: req.body?.status,
        note: req.body?.note,
        actorUserId: req.moderationActor.userId,
      });

      if (!item) {
        res.status(404).json({ error: "Report not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to update report", error);
      res.status(500).json({ error: "Failed to update moderation report" });
    }
  },
);

app.get(
  moderationRoutePaths.actions,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    try {
      const payload = await moderationStore.listActions({
        targetType: req.query?.targetType,
        targetId: req.query?.targetId,
        query: req.query?.query,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        sortDirection: req.query?.sortDirection,
      });

      res.json(payload);
    } catch (error) {
      console.error("[moderation] failed to list actions", error);
      res.status(500).json({ error: "Failed to list moderation actions" });
    }
  },
);

app.get(
  moderationRoutePaths.searchUsers,
  authenticateModerationRequest,
  requireScope("moderateUsers"),
  async (req, res) => {
    const query =
      typeof req.query?.query === "string" ? req.query.query.trim() : "";

    try {
      const payload = await moderationStore.searchUsers({
        query,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        sortDirection: req.query?.sortDirection,
      });
      res.json(payload);
    } catch (error) {
      console.error("[moderation] failed to search users", error);
      res.status(500).json({ error: "Failed to search users" });
    }
  },
);

app.get(
  moderationRoutePaths.searchServers,
  authenticateModerationRequest,
  requireScope("moderateServers"),
  async (req, res) => {
    const query =
      typeof req.query?.query === "string" ? req.query.query.trim() : "";

    try {
      const payload = await moderationStore.searchServers({
        query,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        sortDirection: req.query?.sortDirection,
      });
      res.json(payload);
    } catch (error) {
      console.error("[moderation] failed to search servers", error);
      res.status(500).json({ error: "Failed to search servers" });
    }
  },
);

app.get(
  moderationRoutePaths.searchImages,
  authenticateModerationRequest,
  requireScope("moderateImages"),
  async (req, res) => {
    const query =
      typeof req.query?.query === "string" ? req.query.query.trim() : "";

    try {
      const payload = await moderationStore.searchImages({
        query,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        sortDirection: req.query?.sortDirection,
      });
      res.json(payload);
    } catch (error) {
      console.error("[moderation] failed to search images", error);
      res.status(500).json({ error: "Failed to search images" });
    }
  },
);

app.get(
  moderationRoutePaths.viewUser,
  authenticateModerationRequest,
  requireScope("moderateUsers"),
  async (req, res) => {
    const userId =
      typeof req.params?.userId === "string" ? req.params.userId.trim() : "";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      const item = await moderationStore.getUserById(userId);
      if (!item) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to load user details", error);
      res.status(500).json({ error: "Failed to load user details" });
    }
  },
);

app.patch(
  moderationRoutePaths.viewUser,
  authenticateModerationRequest,
  requireScope("moderateUsers"),
  async (req, res) => {
    const userId =
      typeof req.params?.userId === "string" ? req.params.userId.trim() : "";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      const item = await moderationStore.updateUserModerationProfile(
        userId,
        req.body,
        req.moderationActor.userId,
      );

      if (!item) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error(
        "[moderation] failed to update user moderation profile",
        error,
      );
      res
        .status(500)
        .json({ error: "Failed to update user moderation profile" });
    }
  },
);

app.get(
  moderationRoutePaths.userComments,
  authenticateModerationRequest,
  requireScope("moderateUsers"),
  async (req, res) => {
    const userId =
      typeof req.params?.userId === "string" ? req.params.userId.trim() : "";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      const items = await moderationStore.listUserComments(userId, {
        limit: req.query?.limit,
      });
      res.json({ items });
    } catch (error) {
      console.error("[moderation] failed to list user comments", error);
      res.status(500).json({ error: "Failed to list user comments" });
    }
  },
);

app.post(
  moderationRoutePaths.userComments,
  authenticateModerationRequest,
  requireScope("moderateUsers"),
  async (req, res) => {
    const userId =
      typeof req.params?.userId === "string" ? req.params.userId.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    try {
      const item = await moderationStore.addUserComment(
        userId,
        req.moderationActor.userId,
        body,
        {
          attachments: req.body?.attachments,
          embeds: req.body?.embeds,
        },
      );

      if (!item) {
        res.status(400).json({ error: "Invalid comment payload" });
        return;
      }

      res.status(201).json({ item });
    } catch (error) {
      console.error("[moderation] failed to create user comment", error);
      res.status(500).json({ error: "Failed to create user comment" });
    }
  },
);

app.get(
  moderationRoutePaths.viewServer,
  authenticateModerationRequest,
  requireScope("moderateServers"),
  async (req, res) => {
    const serverId =
      typeof req.params?.serverId === "string"
        ? req.params.serverId.trim()
        : "";

    if (!serverId) {
      res.status(400).json({ error: "serverId is required" });
      return;
    }

    try {
      const item = await moderationStore.getServerById(serverId);
      if (!item) {
        res.status(404).json({ error: "Server not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to load server details", error);
      res.status(500).json({ error: "Failed to load server details" });
    }
  },
);

app.patch(
  moderationRoutePaths.viewServer,
  authenticateModerationRequest,
  requireScope("moderateServers"),
  async (req, res) => {
    const serverId =
      typeof req.params?.serverId === "string"
        ? req.params.serverId.trim()
        : "";

    if (!serverId) {
      res.status(400).json({ error: "serverId is required" });
      return;
    }

    try {
      const item = await moderationStore.updateServerModerationProfile(
        serverId,
        req.body,
        req.moderationActor.userId,
      );

      if (!item) {
        res.status(404).json({ error: "Server not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error(
        "[moderation] failed to update server moderation profile",
        error,
      );
      res
        .status(500)
        .json({ error: "Failed to update server moderation profile" });
    }
  },
);

app.get(
  moderationRoutePaths.serverComments,
  authenticateModerationRequest,
  requireScope("moderateServers"),
  async (req, res) => {
    const serverId =
      typeof req.params?.serverId === "string"
        ? req.params.serverId.trim()
        : "";

    if (!serverId) {
      res.status(400).json({ error: "serverId is required" });
      return;
    }

    try {
      const items = await moderationStore.listServerComments(serverId, {
        limit: req.query?.limit,
      });
      res.json({ items });
    } catch (error) {
      console.error("[moderation] failed to list server comments", error);
      res.status(500).json({ error: "Failed to list server comments" });
    }
  },
);

app.post(
  moderationRoutePaths.serverComments,
  authenticateModerationRequest,
  requireScope("moderateServers"),
  async (req, res) => {
    const serverId =
      typeof req.params?.serverId === "string"
        ? req.params.serverId.trim()
        : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!serverId) {
      res.status(400).json({ error: "serverId is required" });
      return;
    }

    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    try {
      const item = await moderationStore.addServerComment(
        serverId,
        req.moderationActor.userId,
        body,
        {
          attachments: req.body?.attachments,
          embeds: req.body?.embeds,
        },
      );

      if (!item) {
        res.status(400).json({ error: "Invalid comment payload" });
        return;
      }

      res.status(201).json({ item });
    } catch (error) {
      console.error("[moderation] failed to create server comment", error);
      res.status(500).json({ error: "Failed to create server comment" });
    }
  },
);

app.get(
  moderationRoutePaths.viewImage,
  authenticateModerationRequest,
  requireScope("moderateImages"),
  async (req, res) => {
    const imageId =
      typeof req.params?.imageId === "string" ? req.params.imageId.trim() : "";

    if (!imageId) {
      res.status(400).json({ error: "imageId is required" });
      return;
    }

    try {
      const item = await moderationStore.getImageById(imageId);
      if (!item) {
        res.status(404).json({ error: "Image not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to load image details", error);
      res.status(500).json({ error: "Failed to load image details" });
    }
  },
);

app.get(
  moderationRoutePaths.imageComments,
  authenticateModerationRequest,
  requireScope("moderateImages"),
  async (req, res) => {
    const imageId =
      typeof req.params?.imageId === "string" ? req.params.imageId.trim() : "";

    if (!imageId) {
      res.status(400).json({ error: "imageId is required" });
      return;
    }

    try {
      const items = await moderationStore.listImageComments(imageId, {
        limit: req.query?.limit,
      });
      res.json({ items });
    } catch (error) {
      console.error("[moderation] failed to list image comments", error);
      res.status(500).json({ error: "Failed to list image comments" });
    }
  },
);

app.post(
  moderationRoutePaths.imageComments,
  authenticateModerationRequest,
  requireScope("moderateImages"),
  async (req, res) => {
    const imageId =
      typeof req.params?.imageId === "string" ? req.params.imageId.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

    if (!imageId) {
      res.status(400).json({ error: "imageId is required" });
      return;
    }

    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    try {
      const item = await moderationStore.addImageComment(
        imageId,
        req.moderationActor.userId,
        body,
        {
          attachments: req.body?.attachments,
          embeds: req.body?.embeds,
        },
      );

      if (!item) {
        res.status(400).json({ error: "Invalid comment payload" });
        return;
      }

      res.status(201).json({ item });
    } catch (error) {
      console.error("[moderation] failed to create image comment", error);
      res.status(500).json({ error: "Failed to create image comment" });
    }
  },
);

app.patch(
  moderationRoutePaths.caseStatus,
  authenticateModerationRequest,
  requireScope("manageCases"),
  async (req, res) => {
    const caseId =
      typeof req.params?.caseId === "string" ? req.params.caseId.trim() : "";

    if (!caseId) {
      res.status(400).json({ error: "caseId is required" });
      return;
    }

    try {
      const item = await moderationStore.updateCaseStatus({
        caseId,
        status: req.body?.status,
        note: req.body?.note,
        actorUserId: req.moderationActor.userId,
      });

      if (!item) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("[moderation] failed to update case", error);
      res.status(500).json({ error: "Failed to update moderation case" });
    }
  },
);

app.post(
  moderationRoutePaths.actions,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    const targetType =
      typeof req.body?.targetType === "string"
        ? req.body.targetType.trim()
        : "";
    const targetId =
      typeof req.body?.targetId === "string" ? req.body.targetId.trim() : "";
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const actionType =
      typeof req.body?.actionType === "string"
        ? req.body.actionType.trim()
        : "";

    if (!targetType || !targetId || !reason || !actionType) {
      res.status(400).json({
        error: "actionType, targetType, targetId and reason are required",
      });
      return;
    }

    const requiredScope = scopeForTargetType(targetType);
    if (!requiredScope || !req.moderationPermissions.scopes[requiredScope]) {
      res
        .status(403)
        .json({ error: "Missing moderation permission for target" });
      return;
    }

    try {
      let caseItem;
      if (!req.body?.caseId) {
        caseItem = await moderationStore.createCase({
          actorUserId: req.moderationActor.userId,
          targetType,
          targetId,
          reason,
          evidence: req.body?.evidence,
          metadata: req.body?.metadata,
        });
      }

      const action = await moderationStore.createAction({
        actorUserId: req.moderationActor.userId,
        actionType,
        targetType,
        targetId,
        reason,
        caseId: req.body?.caseId ?? caseItem?.id,
        metadata: req.body?.metadata,
      });

      if (!action) {
        res.status(400).json({ error: "Invalid moderation action payload" });
        return;
      }

      res.json({
        ok: true,
        action,
        caseItem,
      });
    } catch (error) {
      console.error("[moderation] failed to apply action", error);
      res.status(500).json({ error: "Failed to apply moderation action" });
    }
  },
);

app.post(
  moderationRoutePaths.bulkActions,
  authenticateModerationRequest,
  requireScope("viewPanel"),
  async (req, res) => {
    const actionType =
      typeof req.body?.actionType === "string"
        ? req.body.actionType.trim()
        : "";
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    const targets = Array.isArray(req.body?.targets)
      ? req.body.targets
      : Array.isArray(req.body?.targetIds)
        ? req.body.targetIds.map((targetId) => ({
            targetType: req.body?.targetType,
            targetId,
          }))
        : [];

    if (!actionType || !reason || targets.length === 0) {
      res.status(400).json({
        error:
          "actionType, reason and at least one target are required for bulk actions",
      });
      return;
    }

    const created = [];

    try {
      for (const entry of targets) {
        const targetType =
          typeof entry?.targetType === "string" ? entry.targetType.trim() : "";
        const targetId =
          typeof entry?.targetId === "string" ? entry.targetId.trim() : "";
        if (!targetType || !targetId) continue;

        const requiredScope = scopeForTargetType(targetType);
        if (
          !requiredScope ||
          !req.moderationPermissions.scopes[requiredScope]
        ) {
          continue;
        }

        let caseItem;
        if (!req.body?.caseId) {
          caseItem = await moderationStore.createCase({
            actorUserId: req.moderationActor.userId,
            targetType,
            targetId,
            reason,
            evidence: req.body?.evidence,
            metadata: req.body?.metadata,
          });
        }

        const action = await moderationStore.createAction({
          actorUserId: req.moderationActor.userId,
          actionType,
          targetType,
          targetId,
          reason,
          caseId: req.body?.caseId ?? caseItem?.id,
          metadata: req.body?.metadata,
        });

        if (action) {
          created.push({ action, caseItem });
        }
      }

      res.json({
        ok: true,
        count: created.length,
        items: created,
      });
    } catch (error) {
      console.error("[moderation] failed to apply bulk actions", error);
      res
        .status(500)
        .json({ error: "Failed to apply moderation bulk actions" });
    }
  },
);

app.use("/client-api", (_req, res) => {
  res.status(404).json({ error: "Unknown client API endpoint" });
});

function shouldServeAppShell(pathname) {
  if (pathname === "/") return true;
  if (pathname.startsWith("/assets/")) return false;
  if (pathname.startsWith("/client-api/")) return false;

  return !pathname.includes(".");
}

app.get("*", (req, res) => {
  if (shouldServeAppShell(req.path)) {
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.sendFile(path.join(distDir, "index.html"));
    return;
  }

  sendErrorPage(
    res,
    404,
    "Page Not Found",
    "The page or file you requested does not exist.",
  );
});

app.use((err, _req, res, _next) => {
  console.error("[server] unhandled error", err);
  captureServerError(err, "express_unhandled");
  sendErrorPage(
    res,
    500,
    "Server Error",
    "Something went wrong while serving this request.",
  );
});

const server = app.listen(port, () => {
  console.info(`[server] listening on http://localhost:${port}`);
  console.info(
    `[client-api] websocket endpoint: ws://localhost:${port}${clientApiSocketPath}`,
  );
  console.info(
    `[client-api] legacy presence endpoint alias: ws://localhost:${port}${legacyPresenceSocketPath}`,
  );
});

const clientApiWss = new WebSocketServer({ noServer: true });
const clientApiWsClients = new Set();
const callStateStore = createCallStateStore({
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB,
  collectionName: process.env.MONGODB_CALL_STATE_COLLECTION || "call_state",
});
const notificationSettingsStore = createNotificationSettingsStore({
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB,
  collectionName:
    process.env.MONGODB_NOTIFICATION_SETTINGS_COLLECTION ||
    "notification_settings",
});
const moderationStore = createModerationStore({
  mongoUri: process.env.MONGODB_URI,
  // Keep cases/actions in the same legacy database used by the old service panel.
  dbName: "revolt",
  rolesCollectionName:
    process.env.MONGODB_MODERATION_ROLES_COLLECTION || "moderation_roles",
  // Keep legacy collection names so moderation/report data remains interoperable.
  casesCollectionName: "safety_cases",
  actionsCollectionName: "safety_strikes",
  usersCollectionName: process.env.MONGODB_USERS_COLLECTION || "users",
  serversCollectionName: process.env.MONGODB_SERVERS_COLLECTION || "servers",
  imagesCollectionName: process.env.MONGODB_IMAGES_COLLECTION || "attachments",
  notificationApiBase: moderationAuthApiBase,
  notificationSystemSessionToken: process.env.MODERATION_SYSTEM_SESSION_TOKEN,
  notificationEmailWebhookUrl: process.env.MODERATION_EMAIL_WEBHOOK_URL,
  superuserIds: [...moderationSuperuserIds],
});

const presenceStream = createPresenceStream({
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB,
  collectionName: process.env.MONGODB_PRESENCE_COLLECTION || "presence",
});

let detachPresenceListener = () => {};

callStateStore.connect().catch((error) => {
  console.error("[call-state] failed to connect", error);
});

notificationSettingsStore.connect().catch((error) => {
  console.error("[notification-settings] failed to connect", error);
});

moderationStore.connect().catch((error) => {
  console.error("[moderation] failed to connect", error);
});

presenceStream
  .connect()
  .then(() => {
    detachPresenceListener = presenceStream.onUpdate((event) => {
      broadcastTypedSocketMessage(clientApiWsClients, {
        type: event.type,
        data: event,
      });
    });
  })
  .catch((error) => {
    console.error("[presence] failed to start stream", error);
  });

clientApiWss.on("connection", async (socket, req) => {
  clientApiWsClients.add(socket);

  try {
    const users = await presenceStream.initialSnapshot();

    sendTypedSocketMessage(socket, {
      type: "presence:snapshot",
      data: {
        users,
      },
    });

    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const requestedChannelId = requestUrl.searchParams.get("channelId");

    const items = requestedChannelId
      ? await callStateStore.getByChannel(requestedChannelId)
      : await callStateStore.getLatest();

    sendTypedSocketMessage(socket, {
      type: "dm-ringing:snapshot",
      data: {
        items,
      },
    });
  } catch (error) {
    console.error("[client-api] failed to send snapshot", error);
  }

  socket.on("close", () => {
    clientApiWsClients.delete(socket);
  });
});

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  if (
    requestUrl.pathname === clientApiSocketPath ||
    requestUrl.pathname === legacyPresenceSocketPath
  ) {
    clientApiWss.handleUpgrade(req, socket, head, (ws) => {
      clientApiWss.emit("connection", ws, req);
    });
    return;
  }

  if (
    requestUrl.pathname !== clientApiSocketPath &&
    requestUrl.pathname !== legacyPresenceSocketPath
  ) {
    socket.destroy();
    return;
  }
});

let cliInterface;
let isShuttingDown = false;
let shutdownPromise;
let shutdownSpinnerTimer;
let shutdownSpinnerFrame = 0;
let shutdownStatusMessage = "";

const shutdownSpinnerFrames = ["|", "/", "-", "\\"];

function renderShutdownStatus(force = false) {
  if (!process.stdout.isTTY) {
    if (force && shutdownStatusMessage) {
      console.info(`[server-cli] ${shutdownStatusMessage}`);
    }
    return;
  }

  const frame = shutdownSpinnerFrames[shutdownSpinnerFrame];
  process.stdout.write(`\r[server-cli] ${frame} ${shutdownStatusMessage}`);
}

function startShutdownStatus(statusMessage) {
  shutdownStatusMessage = statusMessage;
  renderShutdownStatus(true);

  if (!process.stdout.isTTY) return;
  if (shutdownSpinnerTimer) clearInterval(shutdownSpinnerTimer);

  shutdownSpinnerTimer = setInterval(() => {
    shutdownSpinnerFrame =
      (shutdownSpinnerFrame + 1) % shutdownSpinnerFrames.length;
    renderShutdownStatus();
  }, 100);
}

function updateShutdownStatus(statusMessage) {
  shutdownStatusMessage = statusMessage;
  renderShutdownStatus(true);
}

function stopShutdownStatus(finalMessage) {
  if (shutdownSpinnerTimer) {
    clearInterval(shutdownSpinnerTimer);
    shutdownSpinnerTimer = undefined;
  }

  if (process.stdout.isTTY) {
    process.stdout.write("\r");
    process.stdout.write(" ".repeat(120));
    process.stdout.write("\r");
  }

  console.info(`[server-cli] ${finalMessage}`);
}

async function closeHttpServer() {
  if (!server.listening) return;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeWebSocketServer() {
  const shutdownCode = 1001;
  const gracefulTimeoutMs = 5_000;
  const forceTimeoutMs = 1_000;

  if (clientApiWsClients.size > 0) {
    broadcastTypedSocketMessage(clientApiWsClients, {
      type: "server:shutdown",
      data: {
        reason: "server shutting down",
      },
    });

    for (const socket of clientApiWsClients) {
      try {
        socket.close(shutdownCode, "Server shutting down");
      } catch {
        // Ignore invalid socket state errors during shutdown.
      }
    }
  }

  const waitForClientDisconnects = async (timeoutMs) => {
    const startedAt = Date.now();

    while (clientApiWsClients.size > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        return false;
      }

      updateShutdownStatus(
        `closing websocket server (${clientApiWsClients.size} clients remaining)`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return true;
  };

  const disconnectedGracefully =
    await waitForClientDisconnects(gracefulTimeoutMs);

  if (!disconnectedGracefully && clientApiWsClients.size > 0) {
    updateShutdownStatus(
      `forcing websocket disconnect (${clientApiWsClients.size} clients remaining)`,
    );

    for (const socket of clientApiWsClients) {
      try {
        socket.terminate();
      } catch {
        // Ignore invalid socket state errors during shutdown.
      }
    }

    await waitForClientDisconnects(forceTimeoutMs);
    clientApiWsClients.clear();
  }

  await new Promise((resolve) => {
    clientApiWss.close(() => resolve());
  });
}

async function shutdownOnce(reason = "requested") {
  if (shutdownPromise) return shutdownPromise;

  isShuttingDown = true;
  shutdownPromise = (async () => {
    if (cliInterface) {
      cliInterface.close();
      cliInterface = undefined;
    }

    startShutdownStatus(`shutdown requested (${reason})`);

    try {
      updateShutdownStatus("detaching presence listeners");
      detachPresenceListener();

      updateShutdownStatus("closing call state store");
      await callStateStore.close();

      updateShutdownStatus("closing notification settings store");
      await notificationSettingsStore.close();

      updateShutdownStatus("closing moderation store");
      await moderationStore.close();

      updateShutdownStatus("closing presence stream");
      await presenceStream.close();

      updateShutdownStatus("closing websocket server");
      await closeWebSocketServer();

      updateShutdownStatus("closing http server");
      await closeHttpServer();

      stopShutdownStatus("shutdown complete");
      process.exit(0);
    } catch (error) {
      stopShutdownStatus("shutdown failed");
      console.error("[server] graceful shutdown failed", error);
      process.exit(1);
    }
  })();

  return shutdownPromise;
}

process.once("SIGINT", () => {
  void shutdownOnce("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdownOnce("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection", reason);
  captureServerError(reason, "process_unhandled_rejection");
});

process.on("uncaughtException", (error) => {
  console.error("[server] uncaught exception", error);
  captureServerError(error, "process_uncaught_exception");
});

function handleServerCommand(rawInput) {
  const input = String(rawInput || "")
    .trim()
    .toLowerCase();
  if (!input) return;

  if (input === "exit" || input === "quit" || input === "stop") {
    void shutdownOnce("cli command");
    return;
  }

  if (input === "help") {
    console.info("[server-cli] available commands: help, exit");
    return;
  }

  console.info(`[server-cli] unknown command: ${input}`);
}

if (process.stdin && process.stdin.isTTY) {
  cliInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.info("[server-cli] command line ready (type 'help' or 'exit')");
  cliInterface.on("line", (line) => {
    handleServerCommand(line);
    if (!isShuttingDown) {
      cliInterface.prompt();
    }
  });

  // When readline is active, handle Ctrl+C directly here so shutdown is always triggered.
  cliInterface.on("SIGINT", () => {
    void shutdownOnce("SIGINT");
  });

  cliInterface.prompt();
}

process.on("exit", () => {
  if (cliInterface) {
    cliInterface.close();
    cliInterface = undefined;
  }

  if (shutdownSpinnerTimer) {
    clearInterval(shutdownSpinnerTimer);
    shutdownSpinnerTimer = undefined;
  }
});
