import type { ElementContent, Root, RootContent } from "hast";

/** Linkify Markdown links in preformatted blocks without parsing their layout as Markdown. */
export function rehypeCodeLinks() {
  return (tree: Root) => {
    function walk(node: Root | RootContent) {
      if (node.type === "element" && node.tagName === "pre") {
        for (const code of node.children) {
          if (code.type !== "element" || code.tagName !== "code") continue;
          const classes = code.properties.className;
          if (Array.isArray(classes) && classes.some((name) => ["language-math", "math-display", "math-inline"].includes(String(name)))) continue;

          code.children = code.children.flatMap((child): ElementContent[] => {
            if (child.type !== "text") return [child];
            const result: ElementContent[] = [];
            // Wiki targets have already been expanded by prepareWikiLinks.
            // Leave image syntax, raw HTML, whitespace and incomplete links literal.
            const pattern = /(?<!!)\[([^\]\n]+)\]\((<[^>\n]+>|[^\s)]+)(?:[ \t]+"([^"\n]*)")?\)/g;
            let offset = 0;
            for (const match of child.value.matchAll(pattern)) {
              result.push({ type: "text", value: child.value.slice(offset, match.index) });
              const href = match[2].startsWith("<") ? match[2].slice(1, -1) : match[2];
              result.push({
                type: "element", tagName: "a",
                properties: { href, ...(match[3] ? { title: match[3] } : {}) },
                children: [{ type: "text", value: match[1] }],
              });
              offset = match.index + match[0].length;
            }
            result.push({ type: "text", value: child.value.slice(offset) });
            return result;
          });
        }
        return;
      }
      if ("children" in node) for (const child of node.children) walk(child);
    }
    walk(tree);
  };
}
