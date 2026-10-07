import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const launcher = new URL("../scripts/start.mjs", import.meta.url).href;
for (const scenario of ["SIGTERM", "SIGINT", "child-signal", "child-error", "child-zero", "child-first", "deadline"]) {
  test(`launcher handles ${scenario}`, { timeout: 10000 }, async (t) => {
    const script = `
      import { spawn } from 'node:child_process';
      import { supervise } from ${JSON.stringify(launcher)};
      const scenario = ${JSON.stringify(scenario)};
      const children = [0, 1].map(i => ({ name: 'child ' + i, child: spawn(process.execPath, ['-e', \`
        process.on('SIGTERM', () => { if (${JSON.stringify(scenario)} !== 'deadline') setTimeout(() => process.exit(0), 150); });
        process.on('message', code => process.exit(code));
        setInterval(() => {}, 1000);
        process.send('ready');
      \`], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }) }));
      supervise(children, 300);
      let ready = 0;
      for (const { child } of children) child.once('message', () => {
        if (++ready === 2) process.send('ready');
      });
      process.on('message', () => {
        if (scenario === 'child-error' || scenario === 'child-zero') {
          children[0].child.send(scenario === 'child-zero' ? 0 : 7);
        } else if (scenario.startsWith('child-')) {
          children[0].child.kill('SIGKILL');
          if (scenario === 'child-first') setTimeout(() => process.kill(process.pid, 'SIGTERM'), 30);
        } else process.kill(process.pid, scenario === 'deadline' ? 'SIGTERM' : scenario);
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    let logs = "";
    child.stdout!.on("data", data => { logs += data; });
    child.stderr!.on("data", data => { logs += data; });
    const exited = once(child, "exit");
    await once(child, "message");
    child.send("go");
    const [code, signal] = await exited;
    assert.equal(signal, null, logs);
    const expected = scenario === "child-error" ? 7 : ["child-signal", "child-zero"].includes(scenario) ? 1 : 0;
    assert.equal(code, expected, logs);
    if (scenario === "deadline") assert.match(logs, /Shutdown deadline/);
  });
}
