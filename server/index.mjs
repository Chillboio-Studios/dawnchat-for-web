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

  res.status(410).json({
    error:
      "Client API on this server is retired. Use dawnchat-api endpoints and events websocket.",
  });
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
  console.info("[server] client-api websocket endpoints are retired");
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
    socket.destroy();
    return;
  }

  socket.destroy();
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
