import type { Element, Root, RootContent } from "hast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import { prepareWikiLinks } from "./wiki";

export type ArticleHeading = { id: string; title: string; depth: number };

export function prepareArticleMarkdown(content: string, wiki: string) {
  return prepareWikiLinks(content.replace(/^#\s+.+?(?:\r?\n)+/, ""), wiki);
}

function headingText(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "img") return String(node.properties.alt ?? "");
  if (node.tagName === "br") return " ";
  return node.children.map(headingText).join("");
}

/** Use the same parsed headings for the sidebar and the rendered article anchors. */
function assignHeadingIds(tree: Root): ArticleHeading[] {
  const headings: Element[] = [];
  const reserved = new Set<string>();
  function walk(node: Root | RootContent) {
    if (node.type === "element") {
      if (node.properties.id) reserved.add(String(node.properties.id));
      if (/^h[2-6]$/.test(node.tagName)) headings.push(node);
    }
    if ("children" in node) node.children.forEach(walk);
  }
  walk(tree);

  const assigned = new Set<string>();
  return headings.flatMap((heading) => {
    const title = headingText(heading).replace(/\s+/g, " ").trim();
    if (!title) return [];
    const existingId = String(heading.properties.id ?? "");
    const base = existingId || title.normalize("NFKC").toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/[\s_]+/g, "-") || "section";
    let id = base;
    let suffix = 1;
    while (assigned.has(id) || (reserved.has(id) && id !== existingId)) id = `${base}-${suffix++}`;
    heading.properties.id = id;
    assigned.add(id);
    reserved.add(id);
    return [{ id, title, depth: Number(heading.tagName[1]) }];
  });
}

export function rehypeArticleHeadings() {
  return (tree: Root) => { assignHeadingIds(tree); };
}

const headingParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);

export function articleHeadings(markdown: string): ArticleHeading[] {
  return assignHeadingIds(headingParser.runSync(headingParser.parse(markdown)) as Root);
}
