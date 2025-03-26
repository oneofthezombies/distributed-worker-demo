import { drizzle } from "drizzle-orm/bun-sql";
import { taskLogsTable, tasksTable } from "./db/schema.ts";
import { and, eq, isNull } from "drizzle-orm/expressions";
import { gunzip } from "node:zlib";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { TaskLog, UpdateTaskStatus } from "@internal/worker-core";

type Db = ReturnType<typeof drizzle>;
const TaskId = z.preprocess((val) => Number(val), z.number().int());
type TaskId = z.infer<typeof TaskId>;

const DEMO_TASK_COUNT = 1;
const env = parseEnv();

// log collection measurement (byteLength/sec)
const logCollectionMeasurement = {
  INTERVAL_MS: 1000,
  byteLength: 0,
  maxByteLength: 0,
};

await main();

async function main() {
  const db = drizzle(env.databaseUrl);
  await initDemoDb(db);

  const stopLogCollectionMeasurement = startLogCollectionMeasurement();
  const server = Bun.serve({
    reusePort: true,
    routes: {
      "/": {
        GET: () => new Response("Distributed Worker Demo"),
      },
      "/tasks/pull": {
        POST: async () => {
          const task = await pullTask(db);
          return Response.json(task);
        },
      },
      "/tasks/:taskId/status": {
        PATCH: async (req) => {
          const taskId = await TaskId.parseAsync(req.params.taskId);
          const body = await UpdateTaskStatus.parseAsync(await req.json());
          await updateTaskStatus(db, taskId, body);
          return Response.json({});
        },
      },
      "/tasks/:taskId/logs": {
        POST: async (req) => {
          const taskId = await TaskId.parseAsync(req.params.taskId);
          const encoding = req.headers.get("Content-Encoding");
          let bodyRaw;
          if (encoding === "gzip") {
            const buffer = await req.arrayBuffer();
            const decompressed = await gunzipAsync(buffer);
            bodyRaw = JSON.parse(new TextDecoder().decode(decompressed));
          } else {
            bodyRaw = await req.json();
          }

          const body = await TaskLog.parseAsync(bodyRaw);
          await addTaskLog(db, taskId, body);

          logCollectionMeasurement.byteLength += new TextEncoder().encode(
            body.content
          ).byteLength;
          return Response.json({});
        },
      },
    },
  });

  await new Promise((resolve) => {
    process.on("SIGINT", () => {
      console.log("Received shutdown signal.");
      server.stop().then(resolve);
    });
  });

  console.log("Server finished.");
  stopLogCollectionMeasurement();
}

async function initDemoDb(db: Db) {
  // delete old data
  await db.execute("TRUNCATE TABLE task_logs, tasks RESTART IDENTITY;");

  // create task for demo
  const command = `start=$(date +%s); i=0; while true; do \
    echo "$(TZ=UTC date '+%Y-%m-%d %H:%M:%S').$(TZ=UTC date +%N) - Logging $((i++))"; \
    now=$(date +%s); \
    [ $((now - start)) -ge 10 ] && break; \
  done
  `;

  const rows = [];
  for (let i = 0; i < DEMO_TASK_COUNT; ++i) {
    rows.push({
      command,
    } satisfies typeof tasksTable.$inferInsert);
  }
  await db.insert(tasksTable).values(rows);
}

async function pullTask(db: Db) {
  return await db.transaction(async (tx) => {
    const tasks = await tx
      .select()
      .from(tasksTable)
      .where(
        and(eq(tasksTable.status, "pending"), isNull(tasksTable.deletedAt))
      )
      .orderBy(tasksTable.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (tasks.length === 0) {
      return null;
    }

    const task = tasks[0]!;
    await tx
      .update(tasksTable)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(tasksTable.id, task.id));

    return task;
  });
}

async function addTaskLog(db: Db, taskId: number, body: TaskLog) {
  const { kind, index, content } = body;
  await db.insert(taskLogsTable).values({
    taskId,
    kind,
    index,
    content,
  } satisfies typeof taskLogsTable.$inferInsert);
}

async function updateTaskStatus(
  db: Db,
  taskId: number,
  body: UpdateTaskStatus
) {
  const { status } = body;
  await db
    .update(tasksTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId));
}

function gunzipAsync(buffer: ArrayBuffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(buffer, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function parseEnv() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("Please define DATABASE_URL environment variable.");
  }

  return { databaseUrl };
}

function toReadableByteLength(byteLength: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = byteLength;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function startLogCollectionMeasurement() {
  const measureIntervalId = setInterval(() => {
    const { byteLength, maxByteLength } = logCollectionMeasurement;

    logCollectionMeasurement.byteLength = 0;
    if (byteLength > maxByteLength) {
      logCollectionMeasurement.maxByteLength = byteLength;
      console.log(
        `Max measurement value: ${toReadableByteLength(
          byteLength
        )}/s ${byteLength} B/s`
      );
    }
  }, logCollectionMeasurement.INTERVAL_MS);

  return () => {
    clearInterval(measureIntervalId);
  };
}
