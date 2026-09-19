import OpenAI from "openai";

function createGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Set GEMINI_API_KEY to generate articles.");

  return new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
}

export async function* generateArticleText(prompt: string, client = createGeminiClient()) {
  const stream = await client.chat.completions.create({
    model: "gemini-3.8-flash",
    messages: [{ role: "user", content: prompt }],
    reasoning_effort: "high",
    stream: true,
  });

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    if (choice.delta.refusal || choice.finish_reason === "content_filter") {
      throw new Error("Gemini declined to generate this article.");
    }
    if (choice.finish_reason && choice.finish_reason !== "stop") {
      throw new Error(`Gemini article generation was incomplete: ${choice.finish_reason}.`);
    }

    // Only publish article text; never include reasoning or other metadata.
    if (choice.delta.content) yield choice.delta.content;
    if (choice.finish_reason === "stop") return;
  }

  throw new Error("Gemini article generation ended before completion.");
}
