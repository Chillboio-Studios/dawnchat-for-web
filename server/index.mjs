import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import { WebSocketServer } from "ws";

import { createCallStateStore } from "./callStateStore.mjs";
import { createPresenceStream } from "./presenceStream.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.resolve(rootDir, "packages/client/dist");

dotenv.config({ path: path.resolve(rootDir, ".env") });

const envPort = Number(process.env.SERVER_PORT);
const port = Number.isInteger(envPort) && envPort > 0 ? envPort : 5000;
const clientApiSocketPath =
  process.env.CLIENT_API_WS_PATH || "/client-api/socket";
const legacyPresenceSocketPath = process.env.PRESENCE_WS_PATH || "/presence";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

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

  if (!channelId || !callId || !isValidCallStatus(status)) return undefined;

  return {
    channelId,
    callId,
    status,
    updatedAt: Date.now(),
    startedById: startedById || undefined,
    updatedById: updatedById || undefined,
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
    if (!persisted) {
      res.status(503).json({ error: "Call state store is unavailable" });
      return;
    }

    broadcastTypedSocketMessage(clientApiWsClients, {
      type: "dm-ringing:update",
      data: persisted,
    });

    res.json({ ok: true, item: persisted });
  } catch (error) {
    console.error("[client-api] failed to persist dm-ringing state", error);
    res.status(500).json({ error: "Failed to persist call state" });
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

const presenceStream = createPresenceStream({
  mongoUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB,
  collectionName: process.env.MONGODB_PRESENCE_COLLECTION || "presence",
});

let detachPresenceListener = () => {};

callStateStore.connect().catch((error) => {
  console.error("[call-state] failed to connect", error);
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

const shutdown = async () => {
  detachPresenceListener();

  await callStateStore.close();
  await presenceStream.close();

  clientApiWss.close();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
