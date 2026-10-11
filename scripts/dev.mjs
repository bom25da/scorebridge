import { spawn } from "node:child_process";
const children = [
  ["node_modules/.bin/tsx", "src/server.ts"],
  ["node_modules/.bin/tsx", "src/worker.ts"],
  ["node_modules/.bin/vite"],
].map(([command, ...args]) => spawn(command, args, { stdio: "inherit" }));
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
