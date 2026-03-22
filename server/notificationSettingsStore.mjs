import console from "node:console";

import { MongoClient } from "mongodb";

function isNotificationState(value) {
  return value === "all" || value === "mention" || value === "none";
}

function cleanMuteMap(input) {
  const result = {};
  if (!input || typeof input !== "object") return result;

  const now = Date.now();
  for (const [key, value] of Object.entries(input)) {
    if (!key || !value || typeof value !== "object") continue;

    const until = value.until;
    if (typeof until === "undefined") {
      result[key] = {};
      continue;
    }

    if (typeof until === "number" && Number.isFinite(until) && until > now) {
      result[key] = { until };
    }
  }

  return result;
}

function cleanStateMap(input) {
  const result = {};
  if (!input || typeof input !== "object") return result;

  for (const [key, value] of Object.entries(input)) {
    if (isNotificationState(value)) {
      result[key] = value;
    }
  }

  return result;
}

function cleanNotificationSettings(input) {
  if (!input || typeof input !== "object") {
    return {
      server: {},
      channel: {},
      server_mutes: {},
      channel_mutes: {},
    };
  }

  return {
    server: cleanStateMap(input.server),
    channel: cleanStateMap(input.channel),
    server_mutes: cleanMuteMap(input.server_mutes),
    channel_mutes: cleanMuteMap(input.channel_mutes),
  };
}

export function createNotificationSettingsStore({
  mongoUri,
  dbName,
  collectionName = "notification_settings",
  logger = console,
}) {
  let client;
  let collection;

  async function connect() {
    if (!mongoUri || !dbName) {
      logger.warn(
        "[notification-settings] missing MONGODB_URI or MONGODB_DB, store is disabled",
      );
      return;
    }

    client = new MongoClient(mongoUri);
    await client.connect();

    const db = client.db(dbName);
    collection = db.collection(collectionName);
    await collection.createIndex(
      { userId: 1 },
      { unique: true, name: "userId_unique" },
    );

    logger.info(
      `[notification-settings] using ${dbName}.${collectionName} for user notification settings`,
    );
  }

  async function getByUserId(userId) {
    if (!collection || !userId) return undefined;

    const doc = await collection.findOne(
      { userId },
      {
        projection: {
          _id: 0,
          userId: 1,
          settings: 1,
          updatedAt: 1,
        },
      },
    );

    if (!doc) return undefined;

    return {
      userId,
      settings: cleanNotificationSettings(doc.settings),
      updatedAt:
        doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : Date.now(),
    };
  }

  async function upsertByUserId(userId, settings) {
    if (!collection || !userId) return undefined;

    const cleaned = cleanNotificationSettings(settings);
    const updatedAt = new Date();

    await collection.updateOne(
      { userId },
      {
        $set: {
          userId,
          settings: cleaned,
          updatedAt,
        },
      },
      { upsert: true },
    );

    return {
      userId,
      settings: cleaned,
      updatedAt: updatedAt.getTime(),
    };
  }

  async function close() {
    await client?.close();
  }

  return {
    connect,
    getByUserId,
    upsertByUserId,
    close,
  };
}
