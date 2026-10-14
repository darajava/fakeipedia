import type { ArticleHeading } from "@/lib/article-headings";

type Section = ArticleHeading & { children: Section[] };

export function WikiTableOfContents({ headings }: { headings: ArticleHeading[] }) {
  if (!headings.length) return null;
  const sections: Section[] = [];
  const parents: Section[] = [];
  for (const heading of headings) {
    const section = { ...heading, children: [] };
    while (parents.length && parents.at(-1)!.depth >= heading.depth) parents.pop();
    (parents.at(-1)?.children ?? sections).push(section);
    parents.push(section);
  }

  function list(items: Section[]) {
    return <ul>{items.map((section) => <li key={section.id}>
      <a href={`#${encodeURIComponent(section.id)}`}>{section.title}</a>
      {section.children.length > 0 && list(section.children)}
    </li>)}</ul>;
  }

  return <details className="wiki-toc" open>
    <summary>Contents</summary>
    <nav aria-label="Table of contents">{list(sections)}</nav>
  </details>;
}
