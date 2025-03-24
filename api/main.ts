import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { taskLogsTable, tasksTable } from "./db/schema.ts";
import { and, eq, isNull } from "drizzle-orm/expressions";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

type Db = ReturnType<typeof drizzle>;

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
    "/tasks/:taskId/heartbeat",
    zValidator(
      "param",
      z.object({
        taskId: zStringToInt(),
      })
    ),
    async (c) => {
      const { taskId } = c.req.valid("param");
      await updateTaskHeartbeat(db, taskId);
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
    zValidator(
      "json",
      z.object({
        linesIndex: z.number(),
        lines: z.string(),
      })
    ),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { linesIndex, lines } = c.req.valid("json");
      await addTaskLog(db, taskId, linesIndex, lines);
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
  await server.finished;
  console.log("Server finished.");
  Deno.exit(0);
}

function createDb(): Db {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) {
    throw new Error("Please define DATABASE_URL.");
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
  const rows = Array.from({ length: 10 }).map(
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

async function updateTaskHeartbeat(db: Db, taskId: number) {
  const now = new Date();
  await db
    .update(tasksTable)
    .set({ heartbeatAt: now, updatedAt: now })
    .where(eq(tasksTable.id, taskId));
}

async function addTaskLog(
  db: Db,
  taskId: number,
  linesIndex: number,
  lines: string
) {
  await db.insert(taskLogsTable).values({
    taskId,
    linesIndex,
    lines,
  } satisfies typeof taskLogsTable.$inferInsert);
}

function zStringToInt() {
  return z.preprocess((v) => Number(v), z.number().int());
}
