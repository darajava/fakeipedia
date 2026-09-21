import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { ensureArticleQuestions } from "@/lib/article-question-store";
import { ArticleBusyError } from "@/lib/article-lock";
import { questionTargets } from "@/lib/article-questions";
import { validSlug, validWikiSlug } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.wiki !== "string" || !validWikiSlug(body.wiki) || typeof body.sourceSlug !== "string" || !validSlug(body.sourceSlug) || typeof body.slug !== "string" || !validSlug(body.slug)) {
      return Response.json({ error: "A valid wiki, source and target are required." }, { status: 400 });
    }
    const [existing] = await db.select({ id: articles.id }).from(articles).where(and(eq(articles.wiki, body.wiki), eq(articles.slug, body.slug))).limit(1);
    if (existing) return Response.json({ exists: true });
    const [source] = await db.select().from(articles).where(and(eq(articles.wiki, body.wiki), eq(articles.slug, body.sourceSlug))).limit(1);
    if (!source || !questionTargets(source, body.wiki).some((target) => target.slug === body.slug)) {
      return Response.json({ error: "The source article no longer links to this page." }, { status: 400 });
    }
    const set = await ensureArticleQuestions(source, body.retry === true);
    const question = set.questions.find((entry) => entry.slug === body.slug)!;
    return Response.json({ questionSetId: set.id, question: question.question, title: question.title, sourceTitle: source.title, fallback: set.status !== "ready" });
  } catch (error) {
    if (error instanceof ArticleBusyError) return Response.json({ pending: true }, { status: 202 });
    console.error("Question preparation failed:", error);
    return Response.json({ error: "Could not load a question. Please retry or skip to generate the article." }, { status: 500 });
  }
}
