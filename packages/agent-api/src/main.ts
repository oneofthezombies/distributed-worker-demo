import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { taskLogsTable, tasksTable } from "./db/schema.ts";
import { and, eq, isNull } from "drizzle-orm/expressions";
import { gunzip } from "node:zlib";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import { z } from "zod";
import { TaskLog, UpdateTaskStatus } from "@internal/agent-core";
import express, {
  type NextFunction,
  type Request as RequestEx,
  type Response as ResponseEx,
} from "express";

const gunzipAsync = promisify(gunzip);

type Db = ReturnType<typeof drizzle>;
const TaskId = z.preprocess((val) => Number(val), z.number().int());
type TaskId = z.infer<typeof TaskId>;

const DEMO_TASK_COUNT = 2;
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

  const measureIntervalId = setInterval(() => {
    const { byteLength, maxByteLength } = logCollectionMeasurement;

    logCollectionMeasurement.byteLength = 0;
    if (byteLength > maxByteLength) {
      logCollectionMeasurement.maxByteLength = byteLength;

      console.log(
        `Max log collection performance: ${toReadableByteLength(
          byteLength
        )}/s ${byteLength} B/s`
      );
    }
  }, logCollectionMeasurement.INTERVAL_MS);

  const app = express();
  app.use(gzipBodyParser);
  app.use(jsonBodyParser);

  app.get("/", (_, res) => {
    res.send("Distributed Worker Demo");
  });

  app.post("/tasks/pull", async (_, res) => {
    const task = await pullTask(db);
    res.json(task);
  });

  app.patch("/tasks/:taskId/status", async (req, res) => {
    const taskId = await TaskId.parseAsync(req.params.taskId);
    const body = await UpdateTaskStatus.parseAsync(req.body);
    await updateTaskStatus(db, taskId, body);
    res.json({});
  });

  app.post("/tasks/:taskId/logs", async (req, res) => {
    const taskId = await TaskId.parseAsync(req.params.taskId);
    const body = await TaskLog.parseAsync(req.body);
    await addTaskLog(db, taskId, body);

    logCollectionMeasurement.byteLength += new TextEncoder().encode(
      body.content
    ).byteLength;

    res.json({});
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const server = app.listen(3000, () => {
      console.log("Server listen on 3000");
      resolve(server);
    });
  });

  let shutdownRequested = false;
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      if (shutdownRequested) return;
      shutdownRequested = true;
      console.log("Received shutdown signal.");

      server.close((err) => {
        if (err) {
          console.error("Server finished with error.", err);
        } else {
          console.log("Server finished.");
        }
        resolve();
      });
    });
  });

  clearInterval(measureIntervalId);
  process.exit(0);
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

export async function gzipBodyParser(
  req: RequestEx,
  res: ResponseEx,
  next: NextFunction
) {
  if (req.headers["content-encoding"] !== "gzip") {
    return next();
  }

  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const buffer = Buffer.concat(chunks);
      const decompressed = await gunzipAsync(buffer);
      getContext(req).set("rawBody", decompressed);
      next();
    } catch (err) {
      console.error("Gzip decompression failed.", err);
      res.status(400).send("Invalid gzip body");
    }
  });
}

export async function jsonBodyParser(
  req: RequestEx,
  res: ResponseEx,
  next: NextFunction
) {
  if (req.headers["content-type"] !== "application/json") {
    return next();
  }

  const rawBody = getContext(req).get("rawBody") as Buffer | undefined;
  if (rawBody) {
    try {
      req.body = JSON.parse(rawBody.toString("utf-8"));
      next();
    } catch (e) {
      res.status(400).send("Invalid JSON");
    }
  } else {
    express.json({ limit: "1mb" })(req, res, next);
  }
}

function getContext(request: RequestEx): Map<string, any> {
  if (!Reflect.has(request, "context")) {
    Reflect.set(request, "context", new Map<string, any>());
  }

  return Reflect.get(request, "context");
}
