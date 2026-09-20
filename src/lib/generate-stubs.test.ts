import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { generateStubPages, planStubGeneration } from "./generate-stubs";

const stub = { wiki: "ocean", slug: "stub-world", title: "World brief", content: "[[Ocean World|Enter]] [[Moon]] [[Ocean World|Start here]]" };

test("plans only stubs and uses the final occurrence's target title, not its label or brief title", () => {
  const plan = planStubGeneration([stub, { ...stub, slug: "ordinary" }]);
  assert.deepEqual(plan, [{ stub, slug: "ocean-world", title: "Ocean World" }]);
  assert.throws(() => planStubGeneration([{ ...stub, content: "No links" }]), /No valid target link/);
});

test("generates pages, skips existing pages and continues after a failed page", async () => {
  const plan = planStubGeneration([stub, ...["moon", "sun", "stars"].map((wiki) => ({ ...stub, wiki }))]);
  let calls = 0;
  const messages: string[] = [];
  const result = await generateStubPages(plan, async (request) => {
    const index = calls++;
    assert.deepEqual(await request.json(), {
      wiki: plan[index].stub.wiki, slug: "ocean-world", title: "Ocean World", sourceSlug: "stub-world",
    });
    if (index === 1) return Response.json({ exists: true }, { status: 409 });
    if (index === 2) return new Response('{"type":"error","message":"Text failed"}\n');
    if (index === 3) throw new Error("Database failed");
    // A message can span chunks; image failures must still allow page completion.
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of ['{"type":"text-', 'done"}\n{"type":"image-error","message":"Image failed"}\n', '{"type":"done"}']) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }));
  }, (message) => messages.push(message));
  assert.equal(calls, 4);
  assert.deepEqual(result, { generated: 1, skipped: 1, failed: 2 });
  assert.ok(messages.some((message) => message.includes("Image failed")));
});

test("an interrupted generation stream counts as failure", async () => {
  const result = await generateStubPages(planStubGeneration([stub]), async () => new Response('{"type":"text-done"}\n'), () => {});
  assert.deepEqual(result, { generated: 0, skipped: 0, failed: 1 });
});

test("CLI dry run reads stubs from disk without database or API credentials", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-stub-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "wiki-files/ocean"), { recursive: true });
  await writeFile(path.join(directory, "wiki-files/ocean/stub-world.md"), `# World brief\n\n${stub.content}`);
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import", createRequire(path.resolve("package.json")).resolve("tsx"), path.resolve("src/scripts/generate-stubs.ts"), "--dry-run",
  ], {
    cwd: directory,
    env: { ...process.env, DATABASE_URL: "", GEMINI_API_KEY: "", OPENAI_API_KEY: "" },
  });
  assert.ok(stdout.includes("ocean/stub-world → /w/ocean/ocean-world (Ocean World)"));
  assert.ok(stdout.includes("No database or generation calls made."));
});
