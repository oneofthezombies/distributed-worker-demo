import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import { delay } from "@std/async/delay";
import { ResultTaskStatus, TaskLog, TaskLogKind } from "@internal/interface";
import { Readable } from "node:stream";
import { gzip } from "node:zlib";
import { Buffer } from "node:buffer";

const API_URL = "http://localhost:3000";
const EMPTY_TASK_DELAY_MS = 5000;
const SEND_TASK_LOG_THRESHOLD_LENGTH = 8 * 1024;
const SEND_TASK_LOG_INTERVAL_MS = 5000;

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
    const response = await fetch(`${API_URL}/tasks/pull`, {
      method: "POST",
    });
    const taskRaw = await response.json();
    if (taskRaw !== null) {
      const task = Task.parse(taskRaw);
      await runTask(signal, task);
    } else {
      await delay(EMPTY_TASK_DELAY_MS);
    }
  }

  console.log("Worker finished.");
  Deno.exit(0);
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
          const buffer = await gzipAsync(JSON.stringify(taskLog));
          const response = await fetch(`${API_URL}/tasks/${task.id}/logs`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Encoding": "gzip",
            },
            body: buffer,
          });
          if (!response.ok) {
            console.error(response.status, await response.text());
          }
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
  const response = await fetch(`${API_URL}/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status,
    }),
  });
  if (!response.ok) {
    console.error(
      "Update task status failed.",
      response.status,
      await response.text()
    );
  }
}
