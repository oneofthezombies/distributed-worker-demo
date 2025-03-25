import { delay } from "@std/async/delay";
import { gzip } from "node:zlib";
import { Buffer } from "node:buffer";

const TASK_LOG_LENGTH = 512 * 1024;
const REQUEST_COUNT = 5100;
const API_URL = "http://localhost:3000";

await main();

async function main() {
  const controller = new AbortController();
  const { signal } = controller;
  Deno.addSignalListener("SIGINT", () => {
    console.log("Received shutdown signal.");
    controller.abort();
  });

  const api = new Deno.Command("deno", {
    args: ["task", "start"],
    cwd: await Deno.realPath("../api"),
    signal,
  }).spawn();
  await delay(3000);

  const response = await fetch(`${API_URL}/tasks/pull`, {
    method: "POST",
  });
  const taskRaw = await response.json();
  const taskId = taskRaw.id;
  const content = "a".repeat(TASK_LOG_LENGTH);
  const taskLogRaw = {
    kind: "stdout",
    index: 0,
    content,
  };
  const body = await gzipAsync(JSON.stringify(taskLogRaw));
  for (let i = 0; i < REQUEST_COUNT; ++i) {
    fetch(`${API_URL}/tasks/${taskId}/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body,
    }).then((response) => {
      if (!response.ok) {
        response.text().then((text) => {
          console.error("logs api failed.", response.status, text);
        });
      }
    });
  }
}

function gzipAsync(input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzip(input, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}
