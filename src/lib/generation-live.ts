import { emptyGenerationProgress, type GenerationProgress } from "./generation-progress";

export type GenerationDelta = { type: "delta"; generationId: string; offset: number; delta: string };
export type GenerationSnapshot = {
  type: "snapshot"; generationId: string | null; progress: GenerationProgress | null;
  status: string; attempts: number; funding: string; previewComplete: boolean;
};
export type GenerationLiveMessage = GenerationDelta | GenerationSnapshot;
export type LivePreview = { generationId: string | null; progress: GenerationProgress };

export function applyLiveMessage(current: LivePreview, message: GenerationLiveMessage): LivePreview {
  if (message.type === "snapshot") {
    const incoming = message.progress ?? emptyGenerationProgress();
    // A persisted checkpoint can lag the text already delivered live.
    if (current.generationId === message.generationId && incoming.phase === "writing" &&
        (current.progress.phase !== "writing" || incoming.markdown.length < current.progress.markdown.length)) return current;
    return { generationId: message.generationId, progress: incoming };
  }
  if (message.generationId !== current.generationId || current.progress.phase !== "writing") return current;
  const length = current.progress.markdown.length;
  if (message.offset > length) return current; // The next checkpoint recovers any gap.
  const suffix = message.delta.slice(Math.max(0, length - message.offset));
  return suffix ? { ...current, progress: { ...current.progress, markdown: current.progress.markdown + suffix } } : current;
}

// Leave room for JSON escaping and metadata under PostgreSQL's 8KB NOTIFY limit.
export function generationDeltaPackets(generationId: string, offset: number, text: string): GenerationDelta[] {
  const packets: GenerationDelta[] = [];
  let delta = "";
  for (const character of text) {
    if (delta.length + character.length > 800) {
      packets.push({ type: "delta", generationId, offset, delta });
      offset += delta.length; delta = "";
    }
    delta += character;
  }
  if (delta) packets.push({ type: "delta", generationId, offset, delta });
  return packets;
}
