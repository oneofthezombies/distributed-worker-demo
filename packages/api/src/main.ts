import express from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";

main();

function main() {
  config();

  const db = drizzle(process.env["DATABASE_URL"]!);

  const app = express();
  app.use(
    cors({
      methods: ["GET", "PUT", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(helmet());
  app.use(express.json());

  app.get("/", (_, res) => {
    res.send("Hello!");
  });

  app.put("/tasks/pull", (_req, _res) => {});
  app.put("/tasks/:taskId/heartbeat", (_req, _res) => {});
  app.post("/tasks/:taskId/logs", (_req, _res) => {});

  const port = 3000;
  const server = app.listen(port, () => {
    console.log(`API listening on port ${port}.`);
  });
  server.on("error", (err) => {
    console.error("API failed to start.", err);
    process.exit(1);
  });

  process.on("uncaughtException", (err, origin) => {
    console.error(
      "Uncaught exception occurred.",
      "origin:",
      origin,
      ", error:",
      err
    );
  });
}
