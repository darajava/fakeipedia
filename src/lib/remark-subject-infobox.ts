import type { Image, Link, Paragraph, Root } from "mdast";
import { articleLink } from "./wiki";

type InfoboxOptions = { title: string; wiki: string; slug: string };

/** Promote the first article illustration without duplicating it in the body. */
export function remarkSubjectInfobox({ title, wiki, slug }: InfoboxOptions) {
  return (tree: Root) => {
    let subjectImage: Image | undefined;
    const links = new Map<string, Link>();

    for (const block of tree.children) {
      if (block.type !== "paragraph") continue;
      for (const child of block.children) {
        if (!subjectImage && child.type === "image") subjectImage = child;
        if (child.type !== "link" || links.size === 3) continue;
        const link = articleLink(child.url, wiki);
        if (link?.wiki === wiki && link.slug !== slug && !link.slug.startsWith("stub-")) {
          if (!links.has(link.slug)) links.set(link.slug, child);
        }
      }
    }

    // Older articles without an illustration keep their normal text layout.
    if (!subjectImage) return;

    tree.children = tree.children.filter((block) => {
      if (block.type !== "paragraph") return true;
      block.children = block.children.filter((child) => child !== subjectImage);
      return block.children.some((child) => child.type !== "text" || child.value.trim());
    });

    subjectImage.data = {
      ...subjectImage.data,
      hProperties: { ...subjectImage.data?.hProperties, className: ["wiki-subject-image"] },
    };

    const children: Paragraph[] = [
      {
        type: "paragraph",
        data: { hProperties: { className: ["wiki-infobox-title"] } },
        children: [{ type: "strong", children: [{ type: "text", value: title }] }],
      },
      { type: "paragraph", children: [subjectImage] },
    ];

    if (links.size) {
      const related: Paragraph = {
        type: "paragraph",
        data: { hProperties: { className: ["wiki-infobox-links"] } },
        children: [],
      };
      for (const link of links.values()) {
        if (related.children.length) related.children.push({ type: "text", value: " · " });
        related.children.push(link);
      }
      children.push(related);
    }

    // The streaming preview includes its H1; the saved page renders it separately.
    const position = tree.children[0]?.type === "heading" && tree.children[0].depth === 1 ? 1 : 0;
    tree.children.splice(position, 0, {
      type: "blockquote",
      data: {
        hName: "aside",
        hProperties: { className: ["wiki-infobox"], ariaLabel: `${title} at a glance` },
      },
      children,
    });
  };
}
