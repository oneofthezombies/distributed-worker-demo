import "dotenv/config";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import {
  ResultTaskStatus,
  TaskLog,
  TaskLogKind,
  UpdateTaskStatus,
} from "@internal/agent-core";

const gzipAsync = promisify(gzip);

const Task = z.object({
  id: z.number().int(),
  command: z.string(),
});
type Task = z.infer<typeof Task>;

const DEMO_TASK_PROCESSOR_COUNT = 2;
const PULL_TASK_DELAY_MS = 5000;
const SEND_TASK_LOG_THRESHOLD_LENGTH = 512 * 1024;
const SEND_TASK_LOG_INTERVAL_MS = 5000;
const env = parseEnv();

await main();

async function main() {
  const controller = new AbortController();
  const { signal } = controller;
  let shutdownRequested = false;
  process.on("SIGINT", () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.log("Received shutdown signal.");

    controller.abort();
  });

  let taskProcessorCount = 0;
  while (!shutdownRequested) {
    let tryAgainLater = false;
    let taskRaw;
    if (taskProcessorCount == DEMO_TASK_PROCESSOR_COUNT) {
      tryAgainLater = true;
    } else {
      const response = await fetch(`${env.apiUrl}/tasks/pull`, {
        method: "POST",
      });

      if (!response.ok) {
        await logFetchError(response, "Task pulling failed.");
        tryAgainLater = true;
      }

      taskRaw = await response.json();
      if (taskRaw === null) {
        tryAgainLater = true;
      }
    }

    if (tryAgainLater) {
      await delay(PULL_TASK_DELAY_MS);
      continue;
    }

    const task = Task.parse(taskRaw);
    taskProcessorCount += 1;
    runTask(signal, task).finally(() => {
      taskProcessorCount -= 1;
    });
  }

  console.log("Agent finished.");
  process.exit(0);
}

function runTask(signal: AbortSignal, task: Task) {
  console.log("Start to run task.");

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

async function updateTaskStatus(taskId: number, status: ResultTaskStatus) {
  const response = await fetch(`${env.apiUrl}/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status,
    } satisfies UpdateTaskStatus),
  });
  await logFetchError(response, "Update task status failed.");
}

function parseEnv() {
  const apiUrl = process.env["API_URL"];
  if (!apiUrl) {
    throw new Error("Please define API_URL environment variable.");
  }

  const enableLogCompression = process.env["ENABLE_LOG_COMPRESSION"];
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

async function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
