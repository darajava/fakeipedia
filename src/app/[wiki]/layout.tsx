import { notFound } from "next/navigation";
import { validWikiSlug } from "@/lib/wiki";

export default async function WikiLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ wiki: string }>;
}) {
  const { wiki } = await params;
  if (!validWikiSlug(wiki)) notFound();
  return children;
}
