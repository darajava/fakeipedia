import { articlePath } from "./wiki";
import { worldOverviewTarget } from "./world-overview";

type Article = { wiki: string; slug: string; title: string; content: string };

export function planStubGeneration(articles: Article[]) {
  return articles.filter((article) => article.slug.startsWith("stub-")).map((stub) => {
    const target = worldOverviewTarget(stub, stub.wiki);
    if (!target) throw new Error(`No valid target link in ${stub.wiki}/${stub.slug}.`);
    return { stub, slug: target.slug, title: target.title };
  });
}

export async function generateStubPages(
  plan: ReturnType<typeof planStubGeneration>,
  generate: (request: Request) => Promise<Response>,
  log: (message: string) => void = console.log,
) {
  const result = { generated: 0, skipped: 0, failed: 0 };
  for (const { stub, slug, title } of plan) {
    const destination = articlePath(stub.wiki, slug);
    log(`Generating ${destination} from ${stub.slug}…`);
    try {
      const response = await generate(new Request("http://localhost/api/articles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wiki: stub.wiki, slug, title, sourceSlug: stub.slug }),
      }));
      if (!response.ok) {
        const body = await response.json();
        if (response.status === 409 && body.exists === true) {
          result.skipped++;
          log(`Skipped ${destination}: already exists.`);
          continue;
        }
        throw new Error(body.error ?? `Generation returned HTTP ${response.status}.`);
      }
      if (!response.body) throw new Error("Generation returned an empty response.");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = "";
      let completed = false;
      let failure: string | undefined;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const message = JSON.parse(line);
        if (message.type === "done") completed = true;
        if (message.type === "error") failure = message.message ?? "Article generation failed.";
        if (message.type === "image-error") log(`Image unavailable for ${destination}: ${message.message}`);
        if (message.type === "text-done") log(`Saved ${destination}; generating images…`);
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += value;
          const lines = pending.split("\n");
          pending = lines.pop()!;
          for (const line of lines) consume(line);
        }
        consume(pending);
      } finally {
        reader.releaseLock();
      }
      if (failure) throw new Error(failure);
      if (!completed) throw new Error("Generation ended without completing.");
      result.generated++;
      log(`Finished ${destination}.`);
    } catch (error) {
      result.failed++;
      log(`Failed ${destination}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
