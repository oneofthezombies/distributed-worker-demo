import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { taskLogsTable, tasksTable } from "./db/schema.ts";
import { and, eq, isNull } from "drizzle-orm/expressions";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ResultTaskStatus, TaskLog } from "@internal/interface";
import { gunzip } from "node:zlib";
import { Buffer } from "node:buffer";

type Db = ReturnType<typeof drizzle>;

const TOTAL_TASK_COUNT = 10;
const MEASURE_INTERVAL_MS = 1000;

// Measure log ingestion speed (byteLength/sec)
let measureByteLength = 0;
let measureIntervalId: number | null = null;

await main();

async function main() {
  const db = createDb();
  await initDemoDb(db);

  const app = new Hono();
  app.get("/", (c) => c.text("Distributed Worker Demo"));
  app.post("/tasks/pull", async (c) => {
    const task = await pullTask(db);
    return c.json(task);
  });
  app.patch(
    "/tasks/:taskId/status",
    zValidator(
      "param",
      z.object({
        taskId: zStringToInt(),
      })
    ),
    zValidator(
      "json",
      z.object({
        status: z.enum(ResultTaskStatus),
      })
    ),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { status } = c.req.valid("json");
      await updateTaskStatus(db, taskId, status);
      return c.json({});
    }
  );
  app.post(
    "/tasks/:taskId/logs",
    zValidator(
      "param",
      z.object({
        taskId: zStringToInt(),
      })
    ),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const encoding = c.req.header("Content-Encoding");

      let taskLogRaw;
      if (encoding === "gzip") {
        const buffer = await c.req.arrayBuffer();
        const decompressed = await gunzipAsync(buffer);
        taskLogRaw = JSON.parse(new TextDecoder().decode(decompressed));
      } else {
        taskLogRaw = await c.req.json();
      }

      const taskLog = await TaskLog.parseAsync(taskLogRaw);
      await addTaskLog(db, taskId, taskLog);
      return c.json({});
    }
  );

  const controller = new AbortController();
  const { signal } = controller;
  Deno.addSignalListener("SIGINT", () => {
    console.log("Received shutdown signal.");
    controller.abort();
  });
  const server = Deno.serve({ signal, port: 3000 }, app.fetch);

  measureIntervalId = setInterval(() => {
    console.log(
      `Log byte length: ${Math.round(measureByteLength / 1024)} KB/sec`
    );
    measureByteLength = 0;
  }, MEASURE_INTERVAL_MS);

  await server.finished;

  if (measureIntervalId !== null) {
    clearInterval(measureIntervalId);
  }

  console.log("Server finished.");
  Deno.exit(0);
}

function createDb(): Db {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) {
    throw new Error("Please define DATABASE_URL environment variable.");
  }
  return drizzle(url);
}

async function initDemoDb(db: Db) {
  await db.delete(taskLogsTable);
  await db.delete(tasksTable);

  const command = `start=$(date +%s); i=0; while true; do \
    echo "$(TZ=UTC date '+%Y-%m-%d %H:%M:%S').$(TZ=UTC date +%N) - Logging $((i++))"; \
    now=$(date +%s); \
    [ $((now - start)) -ge 10 ] && break; \
  done
  `;
  const rows = Array.from({ length: TOTAL_TASK_COUNT }).map(
    (_) =>
      ({
        command,
      } satisfies typeof tasksTable.$inferInsert)
  );
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

    const task = tasks[0];
    await tx
      .update(tasksTable)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(tasksTable.id, task.id));

    return task;
  });
}

async function addTaskLog(db: Db, taskId: number, taskLog: TaskLog) {
  await db.insert(taskLogsTable).values({
    taskId,
    kind: taskLog.kind,
    index: taskLog.index,
    content: taskLog.content,
  } satisfies typeof taskLogsTable.$inferInsert);

  measureByteLength += new TextEncoder().encode(taskLog.content).byteLength;
}

async function updateTaskStatus(
  db: Db,
  taskId: number,
  status: ResultTaskStatus
) {
  await db
    .update(tasksTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId));
}

function zStringToInt() {
  return z.preprocess((v) => Number(v), z.number().int());
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
