import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { tasksTable } from "./db/schema.ts";

type Db = ReturnType<typeof drizzle>;

await main();

async function main() {
  const db = drizzle(Deno.env.get("DATABASE_URL")!);
  await initDb(db);

  const app = new Hono();
  app.get("/", (c) => c.text("Distributed Worker Demo"));

  app.put("/tasks/pull", (c) => {
    return c.text("");
  });
  app.put("/tasks/:taskId/heartbeat", (c) => {
    return c.text("");
  });
  app.put("/tasks/:taskId/logs", (c) => {
    return c.text("");
  });

  const server = Deno.serve(
    { signal: createGracefulShutdownSignal(), port: 3000 },
    app.fetch
  );
  await server.finished;
  console.log("Server finished.");
}

function createGracefulShutdownSignal() {
  const controller = new AbortController();
  const { signal } = controller;
  Deno.addSignalListener("SIGINT", () => {
    console.log("Received shutdown signal.");
    controller.abort();
  });
  return signal;
}

async function initDb(db: Db) {
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
