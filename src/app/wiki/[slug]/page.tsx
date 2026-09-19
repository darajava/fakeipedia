import { permanentRedirect } from "next/navigation";
import { articlePath } from "@/lib/wiki";

export default async function LegacyArticle({ params }: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  permanentRedirect(articlePath("zorg", slug));
}
