import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn(`echo hello`, { shell: true, stdio: "pipe" });
child.on("close", (code) => {
  console.log(code);
});

const stdout = createInterface({ input: child.stdout });
stdout.on("line", (line) => {
  console.log(line);
});

const stderr = createInterface({ input: child.stderr });
stderr.on("line", (line) => {
  console.error(line);
});
