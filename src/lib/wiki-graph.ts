import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import { articleLink, prepareWikiLinks } from "./wiki";
import { rehypeCodeLinks } from "./rehype-code-links";

// Use the article renderer's Markdown/HTML semantics, not a regex over source:
// Inline code, images, comments and unused link definitions are not edges.
// Links displayed in preformatted tables and diagrams are navigable edges.
const parser = unified().use(remarkParse).use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeCodeLinks);

export function graphArticleLinks(content: string, wiki: string): string[] {
  return articleLinkTargets(content, wiki).map((link) => link.slug);
}

export function articleLinkTargets(content: string, wiki: string): Array<{ slug: string; title: string }> {
  const tree = parser.runSync(parser.parse(prepareWikiLinks(content, wiki)));
  const targets = new Map<string, { slug: string; title: string }>();
  function walk(node: typeof tree | (typeof tree.children)[number], captions = true) {
    if (node.type === "element" && node.tagName === "a") {
      const link = articleLink(String(node.properties.href ?? ""), wiki);
      if (link?.wiki === wiki && !targets.has(link.slug)) targets.set(link.slug, { slug: link.slug, title: link.title });
    }
    if (captions && node.type === "element" && node.tagName === "img") {
      const caption = String(node.properties.title ?? node.properties.alt ?? "");
      walk(parser.runSync(parser.parse(prepareWikiLinks(caption, wiki))), false);
    }
    if ("children" in node) for (const child of node.children) walk(child, captions);
  }
  walk(tree);
  return [...targets.values()];
}

export type GraphRow = [slug: string, title: string, targets: string[]];
