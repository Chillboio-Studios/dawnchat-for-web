import console from "node:console";

import { MongoClient } from "mongodb";

/**
 * Create a MongoDB-backed call/ringing state store.
 */
export function createCallStateStore({
  mongoUri,
  dbName,
  collectionName = "call_state",
  logger = console,
}) {
  let client;
  let collection;

  async function connect() {
    if (!mongoUri || !dbName) {
      logger.warn(
        "[call-state] missing MONGODB_URI or MONGODB_DB, call-state store is disabled",
      );
      return;
    }

    client = new MongoClient(mongoUri);
    await client.connect();

    const db = client.db(dbName);
    collection = db.collection(collectionName);

    await collection.createIndex(
      { channelId: 1, callId: 1 },
      { unique: true, name: "channel_call_unique" },
    );
    await collection.createIndex({ channelId: 1, updatedAt: -1 });

    logger.info(
      `[call-state] using ${dbName}.${collectionName} for call/ringing state`,
    );
  }

  function ensureCollection() {
    return collection;
  }

  function normalizeDocument(document) {
    if (!document) return undefined;

    return {
      channelId: String(document.channelId ?? ""),
      callId: String(document.callId ?? ""),
      status: String(document.status ?? ""),
      updatedAt:
        document.updatedAt instanceof Date
          ? document.updatedAt.getTime()
          : typeof document.updatedAt === "number"
            ? document.updatedAt
            : Date.now(),
      startedById:
        typeof document.startedById === "string"
          ? document.startedById
          : undefined,
      updatedById:
        typeof document.updatedById === "string"
          ? document.updatedById
          : undefined,
    };
  }

  async function upsert(item) {
    const target = ensureCollection();
    if (!target) return undefined;

    const updatedAt = new Date(
      typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
    );

    const setPayload = {
      channelId: item.channelId,
      callId: item.callId,
      status: item.status,
      updatedAt,
    };

    if (typeof item.startedById === "string" && item.startedById) {
      setPayload.startedById = item.startedById;
    }

    if (typeof item.updatedById === "string" && item.updatedById) {
      setPayload.updatedById = item.updatedById;
    }

    await target.updateOne(
      {
        channelId: item.channelId,
        callId: item.callId,
      },
      {
        $set: setPayload,
      },
      {
        upsert: true,
      },
    );

    return {
      ...item,
      updatedAt: updatedAt.getTime(),
    };
  }

  async function getOne(channelId, callId) {
    const target = ensureCollection();
    if (!target) return undefined;

    return normalizeDocument(
      await target.findOne(
        {
          channelId,
          callId,
        },
        {
          projection: {
            _id: 0,
            channelId: 1,
            callId: 1,
            status: 1,
            updatedAt: 1,
            startedById: 1,
            updatedById: 1,
          },
        },
      ),
    );
  }

  async function getByChannel(channelId, limit = 500) {
    const target = ensureCollection();
    if (!target) return [];

    const docs = await target
      .find(
        { channelId },
        {
          projection: {
            _id: 0,
            channelId: 1,
            callId: 1,
            status: 1,
            updatedAt: 1,
            startedById: 1,
            updatedById: 1,
          },
        },
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map(normalizeDocument).filter(Boolean);
  }

  async function getLatest(limit = 1000) {
    const target = ensureCollection();
    if (!target) return [];

    const docs = await target
      .find(
        {},
        {
          projection: {
            _id: 0,
            channelId: 1,
            callId: 1,
            status: 1,
            updatedAt: 1,
            startedById: 1,
            updatedById: 1,
          },
        },
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map(normalizeDocument).filter(Boolean);
  }

  async function close() {
    await client?.close();
  }

  return {
    connect,
    upsert,
    getOne,
    getByChannel,
    getLatest,
    close,
  };
}
