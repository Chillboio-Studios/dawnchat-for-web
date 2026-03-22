import { MongoClient } from "mongodb";

/**
 * Create a MongoDB-backed presence broadcaster.
 */
export function createPresenceStream({
  mongoUri,
  dbName,
  collectionName = "presence",
  logger = console,
}) {
  let client;
  let changeStream;
  let collection;

  async function connect() {
    if (!mongoUri || !dbName) {
      logger.warn(
        "[presence] missing MONGODB_URI or MONGODB_DB, presence stream is disabled",
      );
      return;
    }

    client = new MongoClient(mongoUri);
    await client.connect();

    const db = client.db(dbName);
    collection = db.collection(collectionName);

    changeStream = collection.watch(
      [
        {
          $match: {
            operationType: {
              $in: ["insert", "replace", "update"],
            },
          },
        },
      ],
      { fullDocument: "updateLookup" },
    );

    logger.info(
      `[presence] listening for updates on ${dbName}.${collectionName}`,
    );
  }

  function toEvent(document) {
    if (!document) return undefined;

    const userId = String(document.userId ?? document._id ?? "").trim();
    if (!userId) return undefined;

    const status = {
      ...(document.status ?? {}),
    };

    if (typeof document.presence === "string") {
      status.presence = document.presence;
    }

    if (typeof document.statusText === "string") {
      status.text = document.statusText;
    }

    return {
      type: "presence:update",
      userId,
      presence: status.presence,
      status,
      updatedAt:
        document.updatedAt instanceof Date
          ? document.updatedAt.getTime()
          : Date.now(),
    };
  }

  async function initialSnapshot(limit = 5000) {
    if (!collection) return [];

    const users = await collection
      .find(
        {},
        {
          projection: {
            userId: 1,
            presence: 1,
            status: 1,
            statusText: 1,
            updatedAt: 1,
          },
        },
      )
      .limit(limit)
      .toArray();

    return users
      .map(toEvent)
      .filter(Boolean)
      .map((event) => ({
        userId: event.userId,
        presence: event.presence,
        status: event.status,
        updatedAt: event.updatedAt,
      }));
  }

  function onUpdate(handler) {
    if (!changeStream) return () => {};

    const listener = (change) => {
      const payload = toEvent(change.fullDocument);
      if (payload) handler(payload);
    };

    changeStream.on("change", listener);

    return () => {
      changeStream.off("change", listener);
    };
  }

  async function close() {
    await changeStream?.close();
    await client?.close();
  }

  return {
    connect,
    initialSnapshot,
    onUpdate,
    close,
  };
}
