import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { delay } from "@std/async/delay";
import { ResultTaskStatus, TaskLog, TaskLogKind } from "@internal/interface";
import { Readable } from "node:stream";
import { gzip } from "node:zlib";
import { Buffer } from "node:buffer";

const PULL_TASK_DELAY_MS = 5000;
const SEND_TASK_LOG_THRESHOLD_LENGTH = 8 * 1024;
const SEND_TASK_LOG_INTERVAL_MS = 5000;

const env = parseEnv();

const Task = z.object({
  id: z.number().int(),
  command: z.string(),
});
type Task = z.infer<typeof Task>;

await main();

async function main() {
  const controller = new AbortController();
  const { signal } = controller;
  let shutdownRequested = false;
  Deno.addSignalListener("SIGINT", () => {
    console.log("Received shutdown signal.");
    controller.abort();
    shutdownRequested = true;
  });

  while (!shutdownRequested) {
    const response = await fetch(`${env.apiUrl}/tasks/pull`, {
      method: "POST",
    });

    let tryAgainLater = false;
    if (!response.ok) {
      await logFetchError(response, "Task pulling failed.");
      tryAgainLater = true;
    }

    const taskRaw = await response.json();
    if (taskRaw === null) {
      tryAgainLater = true;
    }

    if (tryAgainLater) {
      await delay(PULL_TASK_DELAY_MS);
      continue;
    }

    const task = Task.parse(taskRaw);
    await runTask(signal, task);
  }

  console.log("Worker finished.");
}

function runTask(signal: AbortSignal, task: Task) {
  return new Promise((resolveInternal, rejectInternal) => {
    let beforeSettles: (() => void)[] = [];
    const invokeBeforeSettles = () => {
      for (const beforeSettle of beforeSettles) {
        beforeSettle();
      }
      beforeSettles = [];
    };

    const resolve = (code: number | NodeJS.Signals) => {
      invokeBeforeSettles();
      updateTaskStatus(task.id, "succeeded");
      resolveInternal(code);
    };

    const reject = (reason: unknown) => {
      invokeBeforeSettles();
      updateTaskStatus(task.id, "failed");
      rejectInternal(reason);
    };

    const child = spawn("bash", ["-c", task.command], {
      stdio: "pipe",
      signal,
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.on("close", (code, signal) => {
        if (code !== null) {
          if (code === 0) {
            resolve(code);
          } else {
            reject(code);
          }
        } else if (signal !== null) {
          reject(signal);
        } else {
          reject("Unexpected close result");
        }
      });

      const startSendTaskLog = (kind: TaskLogKind, readable: Readable) => {
        let index = 0;
        let lines: string[] = [];
        let length = 0;

        const sendTaskLog = async () => {
          if (lines.length === 0) {
            return;
          }
          const taskLog: TaskLog = {
            kind,
            index: index++,
            content: lines.join("\n"),
          };
          lines = [];
          length = 0;

          const stringified = JSON.stringify(taskLog);
          const headers = new Headers([["Content-Type", "application/json"]]);
          let body;
          if (env.enableLogCompression) {
            headers.set("Content-Encoding", "gzip");
            body = await gzipAsync(stringified);
          } else {
            body = stringified;
          }

          const response = await fetch(`${env.apiUrl}/tasks/${task.id}/logs`, {
            method: "POST",
            headers,
            body,
          });
          await logFetchError(response, "Add task log failed.");
        };

        const sendTaskLogIntervalId = setInterval(
          sendTaskLog,
          SEND_TASK_LOG_INTERVAL_MS
        );
        beforeSettles.push(() => {
          clearInterval(sendTaskLogIntervalId);
          sendTaskLog();
        });

        const rl = createInterface({ input: readable });
        rl.on("line", (line) => {
          lines.push(line);
          length += line.length;
          if (length >= SEND_TASK_LOG_THRESHOLD_LENGTH) {
            sendTaskLog();
          }
        });
      };

      startSendTaskLog("stdout", child.stdout);
      startSendTaskLog("stderr", child.stderr);
    });
  });
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

async function updateTaskStatus(taskId: number, status: ResultTaskStatus) {
  const response = await fetch(`${env.apiUrl}/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status,
    }),
  });
  await logFetchError(response, "Update task status failed.");
}

function parseEnv() {
  const apiUrl = Deno.env.get("API_URL");
  if (!apiUrl) {
    throw new Error("Please define API_URL environment variable.");
  }

  const enableLogCompression = Deno.env.get("ENABLE_LOG_COMPRESSION");
  if (!enableLogCompression) {
    throw new Error(
      "Please define ENABLE_LOG_COMPRESSION environment variable."
    );
  }
  return {
    apiUrl,
    enableLogCompression: enableLogCompression === "true",
  };
}

async function logFetchError(response: Response, message: string) {
  if (!response.ok) {
    console.error(message, response.status, await response.text());
  }
}
