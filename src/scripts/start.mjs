import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export function supervise(children, shutdownMs = 20000) {
  let shuttingDown = false;
  let exitCode = 1;
  let forcedShutdown;
  // Register completion before sending signals. Signal-terminated children have
  // a null exitCode, so checking exitCode alone can wait for an event already lost.
  const completions = children.map(({ name, child }) => new Promise(resolve => {
    child.once("error", error => {
      console.error(`${name} failed to start: ${error.message}`);
      resolve();
      stop(1);
    });
    child.once("exit", (code, signal) => {
      resolve();
      if (!shuttingDown) {
        console.error(`${name} exited unexpectedly (code=${code}, signal=${signal}).`);
        stop(code || 1);
      }
    });
  }));

  function stop(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    // Railway must allow at least this much draining time. Worker leases let
    // a replacement recover jobs if an in-flight request cannot finish in time.
    forcedShutdown = setTimeout(() => {
      console.error("Shutdown deadline reached; stopping remaining processes.");
      for (const { child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }, shutdownMs);
    Promise.all(completions).then(() => {
      clearTimeout(forcedShutdown);
      console.log(`Launcher stopped (exit code ${exitCode}).`);
      process.exit(exitCode);
    });
  }

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      console.log(`Launcher received ${signal}; shutting down.`);
      // A container-wide signal may reach a child first. An explicit parent
      // shutdown supersedes that failure while the other processes are draining.
      if (shuttingDown) exitCode = 0;
      else stop(0);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const commands = [
    { name: "Web server", args: ["node_modules/next/dist/bin/next", "start"] },
    { name: "Article worker", args: ["--import", "tsx", "src/scripts/generation-worker.ts"] },
  ];
  supervise(commands.map(({ name, args }) => ({
    name,
    // On Unix, isolate children from the launcher's process-group signals;
    // the launcher forwards shutdown and waits for both children explicitly.
    child: spawn(process.execPath, args, { stdio: "inherit", env: process.env, detached: process.platform !== "win32" }),
  })));
}
