export function validSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function wikiPath(wiki: string): string {
  return `/w/${encodeURIComponent(wiki)}`;
}

export function articlePath(wiki: string, slug: string): string {
  return `${wikiPath(wiki)}/${encodeURIComponent(slug)}`;
}

export function prepareWikiLinks(markdown: string, wiki: string): string {
  return markdown.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, label?: string) => {
      const title = target.trim();
      return `[${label?.trim() || title}](${articlePath(wiki, slugify(title))}?title=${encodeURIComponent(title)})`;
    },
  );
}

// Old links embedded in saved articles stay inside their current wiki.
export function articleLink(href: string | undefined, currentWiki: string) {
  if (!href?.startsWith("/wiki/") && !href?.startsWith("/w/")) {
    return undefined;
  }

  const url = new URL(href, "http://fakeipedia.local");
  const legacyMatch = url.pathname.match(/^\/wiki\/([^/]+)\/?$/);
  const match = url.pathname.match(/^\/w\/([^/]+)\/([^/]+)\/?$/);
  if (!legacyMatch && !match) return undefined;

  try {
    const wiki = match ? decodeURIComponent(match[1]).toLowerCase() : currentWiki;
    const slug = decodeURIComponent(match ? match[2] : legacyMatch![1]).toLowerCase();
    if (!validSlug(wiki) || !validSlug(slug)) return undefined;

    // Keep the original title for missing-article generation, but leave it out
    // of normal article URLs: existing articles already have a saved title.
    const title = url.searchParams.get("title") || titleFromSlug(slug);
    url.searchParams.delete("title");

    return {
      wiki,
      slug,
      title,
      hash: url.hash,
      href: `${articlePath(wiki, slug)}${url.search}${url.hash}`,
    };
  } catch {
    return undefined;
  }
}

export function linkedArticleSlugs(markdown: string, wiki: string): string[] {
  const slugs = new Set<string>();
  const prepared = prepareWikiLinks(markdown, wiki);
  const links = [
    ...prepared.matchAll(/\[[^\]]*\]\((\/[^\s)]+)[^)]*\)/g),
    ...prepared.matchAll(/href=["'](\/[^"']+)["']/g),
  ];

  for (const match of links) {
    const link = articleLink(match[1], wiki);
    if (link?.wiki === wiki) slugs.add(link.slug);
  }

  return [...slugs];
}

export function imageSource(source: string | undefined, wiki: string) {
  if (!source?.startsWith("./images/")) return source;
  const encodedPath = source.slice("./images/".length)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/wiki-images/${encodeURIComponent(wiki)}/${encodedPath}`;
}
