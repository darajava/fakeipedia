import path from "node:path";
import { readWikiImage } from "@/lib/wiki-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: {
  params: Promise<{ wiki: string; image: string[] }>;
}) {
  const { wiki, image } = await params;
  const file = await readWikiImage(path.join(process.cwd(), "wiki-files"), wiki, image);

  if (!file) return new Response("Image not found", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
