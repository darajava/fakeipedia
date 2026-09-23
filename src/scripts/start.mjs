import { spawn } from "node:child_process";
const children = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["--import", "tsx", "src/scripts/generation-worker.ts"], { stdio: "inherit", env: process.env }),
];
let shuttingDown = false;
function stop(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  // Railway may stop sooner; leases allow a replacement worker to recover safely.
  setTimeout(() => { for (const child of children) child.kill("SIGKILL"); process.exit(code); }, 20000).unref();
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve)))).then(() => process.exit(code));
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", code => { if (!shuttingDown) stop(code || 1); });
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
