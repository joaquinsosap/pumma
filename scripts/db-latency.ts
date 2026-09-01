/**
 * Measure the managed Mongo cluster directly: DNS + handshake cost, raw
 * round-trip latency, server capacity, per-collection query cost, whether
 * the notes index is actually picked by the planner, slow ops caught in the
 * act, and whether the app's 10-connection pool queues under load.
 *
 * Read-only: no writes, no index changes, nothing dropped.
 *
 *   npm run db:latency
 */
import { resolveSrv } from "dns/promises";
import { performance } from "perf_hooks";
import { Db, MongoClient } from "mongodb";
import { loadScriptEnv } from "./_env";

// Mirrors lib/mongodb.ts's MONGO_OPTIONS so the concurrency probe below
// contends against the same pool ceiling production requests do.
const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
  maxPoolSize: 10,
  minPoolSize: 5,
  maxIdleTimeMS: 0,
  maxConnecting: 10,
  heartbeatFrequencyMS: 10_000,
} as const;

const COLLECTIONS = ["notes", "tasks", "habits", "goals", "notifications"] as const;

// The sort each collection's real list query uses, from lib/db/mongo/*.ts.
const SORTS: Record<(typeof COLLECTIONS)[number], Record<string, 1 | -1>> = {
  notes: { createdAt: -1 },
  tasks: { createdAt: -1, order: 1 },
  habits: { order: 1 },
  goals: { order: 1, createdAt: 1 },
  notifications: { fireAt: -1 },
};

function ms(start: number, end: number): number {
  return Math.round((end - start) * 100) / 100;
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    min: sorted[0],
    median: pick(0.5),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
  };
}

/** SRV host from a mongodb+srv:// URI, or null for a plain mongodb:// one. */
function srvHostFrom(uri: string): string | null {
  const m = /^mongodb\+srv:\/\/(?:[^@]+@)?([^/?]+)/.exec(uri);
  return m ? m[1] : null;
}

async function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/** Connect a fresh client and ping it, timing each step separately. */
async function timeHandshake(uri: string, srvHost: string | null, label: string) {
  console.log(`\n-- ${label} --`);

  if (srvHost) {
    const t0 = performance.now();
    try {
      const records = await resolveSrv(`_mongodb._tcp.${srvHost}`);
      console.log(`SRV resolve: ${ms(t0, performance.now())}ms (${records.length} hosts)`);
    } catch (err) {
      console.log(`SRV resolve: failed (${(err as Error).message})`);
    }
  } else {
    console.log("SRV resolve: n/a (not a mongodb+srv:// URI)");
  }

  const client = new MongoClient(uri, MONGO_OPTIONS);
  const t1 = performance.now();
  await client.connect();
  console.log(`connect(): ${ms(t1, performance.now())}ms`);

  const t2 = performance.now();
  await client.db().command({ ping: 1 });
  console.log(`first ping: ${ms(t2, performance.now())}ms`);

  return client;
}

async function main() {
  loadScriptEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (check .env.local).");
  const dbName = process.env.MONGODB_DB ?? "puma";
  const srvHost = srvHostFrom(uri);

  await section("1. Connection establishment (cold vs warm)");

  // Cold: an entirely fresh client, closed right after, so its handshake
  // cost is not amortised by anything below.
  const coldClient = await timeHandshake(uri, srvHost, "cold (fresh client)");
  await coldClient.close();

  // Warm: the client the rest of this script reuses. Its first connect()
  // and ping still pay the real handshake cost once; everything after this
  // is on already-open sockets, same as a warmed production pool.
  const client = await timeHandshake(uri, srvHost, "warm (client reused below)");
  const db: Db = client.db(dbName);

  try {
    await section("2. Round-trip latency (20 sequential pings, warm client)");
    const pingSamples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await db.command({ ping: 1 });
      pingSamples.push(ms(t0, performance.now()));
    }
    const pingStats = stats(pingSamples);
    console.log(
      `min=${pingStats.min}ms  median=${pingStats.median}ms  p95=${pingStats.p95}ms  max=${pingStats.max}ms`,
    );

    await section("3. Server identity and capacity");
    let sharedTierGuess = "unknown";
    try {
      const status = await db.admin().command({ serverStatus: 1 });
      console.log(
        `connections: current=${status.connections?.current} available=${status.connections?.available} totalCreated=${status.connections?.totalCreated}`,
      );
      console.log(`process: ${status.process} (mongos = sharded/dedicated cluster)`);
      sharedTierGuess =
        status.process === "mongos"
          ? "dedicated/sharded (not a shared free tier)"
          : "replica set — consistent with a shared tier (M0/M2/M5), but not conclusive";
    } catch (err) {
      console.log(`serverStatus: unavailable (${(err as Error).message})`);
    }
    try {
      const hostInfo = await db.admin().command({ hostInfo: 1 });
      console.log(
        `hostInfo: ${hostInfo.system?.hostname ?? "?"}, cpus=${hostInfo.system?.numCores ?? "?"}, memMB=${hostInfo.system?.memSizeMB ?? "?"}`,
      );
    } catch (err) {
      console.log(`hostInfo: unavailable (${(err as Error).message}) — Atlas restricts this on shared tiers`);
    }
    try {
      const build = await db.admin().command({ buildInfo: 1 });
      console.log(`version: ${build.version}`);
    } catch (err) {
      console.log(`buildInfo: unavailable (${(err as Error).message})`);
    }
    console.log(`tier guess: ${sharedTierGuess}`);

    await section("4. Per-collection cost");
    const firstUser = await db.collection("users").findOne({});
    const userId = firstUser?._id as string | undefined;
    if (!userId) {
      console.log("No user found in the users collection — skipping per-collection queries.");
    } else {
      console.log(`Using userId from first users doc: ${userId}`);
      for (const name of COLLECTIONS) {
        let countStr = "?";
        let sizeStr = "?";
        try {
          const collStats = await db.command({ collStats: name });
          countStr = String(collStats.count ?? "?");
          sizeStr = `${Math.round((collStats.size ?? 0) / 1024)}KB`;
        } catch (err) {
          countStr = `unavailable (${(err as Error).message})`;
        }
        const t0 = performance.now();
        const docs = await db
          .collection(name)
          .find({ userId })
          .sort(SORTS[name])
          .toArray();
        const took = ms(t0, performance.now());
        console.log(
          `${name.padEnd(14)} count=${countStr} size=${sizeStr} query=${took}ms returned=${docs.length}`,
        );
      }

      await section('5. explain("executionStats") for the notes query');
      try {
        const explain = await db
          .collection("notes")
          .find({ userId })
          .sort(SORTS.notes)
          .explain("executionStats");
        const winning = explain.queryPlanner?.winningPlan;
        const stage = winning?.inputStage?.stage ?? winning?.stage;
        const indexName = winning?.inputStage?.indexName ?? winning?.indexName;
        const exec = explain.executionStats;
        console.log(`winning stage: ${stage}${indexName ? ` (index: ${indexName})` : ""}`);
        console.log(
          `docsExamined=${exec?.totalDocsExamined} nReturned=${exec?.nReturned} executionTimeMillis=${exec?.executionTimeMillis}`,
        );
        const indexUsed = stage === "IXSCAN" && indexName === "userId_1_createdAt_-1";
        console.log(
          indexUsed
            ? "-> the { userId: 1, createdAt: -1 } index IS being used."
            : `-> the { userId: 1, createdAt: -1 } index is NOT being used (got ${stage ?? "unknown"}${indexName ? `/${indexName}` : ""}).`,
        );
      } catch (err) {
        console.log(`explain failed: ${(err as Error).message}`);
      }
    }

    await section("6. Long-running ops (currentOp, > 1000ms)");
    try {
      const current = await db.admin().command({
        currentOp: 1,
        active: true,
        microsecs_running: { $gte: 1_000_000 },
      });
      const ops = (current.inprog ?? []) as Array<Record<string, unknown>>;
      if (!ops.length) {
        console.log("No operations currently running longer than 1000ms.");
      } else {
        for (const op of ops) {
          const secsRunning = op.secs_running;
          const ns = op.ns;
          const shape = JSON.stringify(op.command ?? op.query ?? {}).slice(0, 200);
          console.log(`ns=${ns} secs_running=${secsRunning} op=${shape}`);
        }
      }
    } catch (err) {
      console.log(`currentOp: unavailable (${(err as Error).message}) — often restricted on shared tiers`);
    }

    await section("7. Concurrency probe (15 parallel queries, pool maxPoolSize=10)");
    const probeStart = performance.now();
    const probeQuery = () => db.collection("notes").findOne({ userId: userId ?? "__probe__" });
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        probeQuery().then(() => ({ index: i, done: ms(probeStart, performance.now()) })),
      ),
    );
    const byCompletion = [...results].sort((a, b) => a.done - b.done);
    byCompletion.forEach((r, order) => {
      console.log(`#${order + 1} (issued as ${r.index}): completed at ${r.done}ms`);
    });
    const firstTen = byCompletion.slice(0, 10).map((r) => r.done);
    const lastFive = byCompletion.slice(10).map((r) => r.done);
    const gap = lastFive.length
      ? Math.min(...lastFive) - Math.max(...firstTen)
      : 0;
    const queueingObserved = lastFive.length > 0 && gap > 5;
    console.log(
      queueingObserved
        ? `-> pool queueing OBSERVED: the last 5 waited ~${Math.round(gap)}ms behind the first batch of 10 (maxPoolSize=10, so #11-15 had to wait for a socket to free up).`
        : "-> no clear pool queueing: the last 5 finished close behind the first 10 (cluster/network answered fast enough that 15 in flight didn't saturate the pool).",
    );

    await section("Verdict");
    console.log(
      pingStats.median < 10
        ? `Round-trip latency healthy: median ${pingStats.median}ms is consistent with a local/same-region cluster.`
        : pingStats.median > 100
          ? `Round-trip latency BAD: median ${pingStats.median}ms means the cluster is far away, throttled, or under load. This alone can explain slow requests.`
          : `Round-trip latency middling: median ${pingStats.median}ms. Not the smoking gun on its own, but worth cross-checking against p95/max (p95=${pingStats.p95}ms, max=${pingStats.max}ms).`,
    );
    console.log(`Index usage: see section 5 above for whether the notes query hit IXSCAN or a scan.`);
    console.log(`Pool queueing: ${queueingObserved ? "observed — see section 7." : "not observed in this run — see section 7."}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
