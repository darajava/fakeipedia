import { permanentRedirect } from "next/navigation";
import { articlePath } from "@/lib/wiki";

export default async function LegacyGenerate({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ title?: string; source?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const search = new URLSearchParams();
  if (query.title) search.set("title", query.title);
  if (query.source) search.set("source", query.source);
  permanentRedirect(`${articlePath("zorg", slug)}/generate?${search}`);
}
