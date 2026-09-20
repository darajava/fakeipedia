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
  const tree = parser.runSync(parser.parse(prepareWikiLinks(content, wiki)));
  const targets = new Set<string>();
  function walk(node: typeof tree | (typeof tree.children)[number]) {
    if (node.type === "element" && node.tagName === "a") {
      const link = articleLink(String(node.properties.href ?? ""), wiki);
      if (link?.wiki === wiki) targets.add(link.slug);
    }
    if ("children" in node) for (const child of node.children) walk(child);
  }
  walk(tree);
  return [...targets];
}

export type GraphRow = [slug: string, title: string, targets: string[]];
