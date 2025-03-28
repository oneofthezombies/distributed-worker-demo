import { mkdir, writeFile } from "node:fs/promises";

const contents = [];
let content = "";
while (true) {
  const tempContent = contents.join("\n");
  if (new TextEncoder().encode(tempContent).byteLength >= 512 * 1024) {
    content = tempContent;
    break;
  }
  contents.push("2025-03-28T22:31:54.366036-04:00 INFO Hello World!");
}

await mkdir("temp", { recursive: true });
await writeFile("temp/task_log.txt", content);
