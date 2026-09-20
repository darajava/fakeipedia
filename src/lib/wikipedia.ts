function normalizedTitle(title: string): string {
  const normalized = title.replace(/_/g, " ").trim().replace(/\s+/g, " ").normalize("NFC");
  return normalized.toLowerCase();
}

/** Confirm a full title match (including aliases), then verify its article exists. */
export async function wikipediaArticleUrl(
  title: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const expectedTitle = normalizedTitle(title);
  // Pipes query multiple pages; fragments refer to sections, not article names.
  if (!expectedTitle || /[|#\u0000-\u001f]/.test(expectedTitle)) return null;

  try {
    const signal = AbortSignal.timeout(5000);
    async function request(parameters: Record<string, string>) {
      const query = new URLSearchParams({ format: "json", ...parameters });
      const response = await fetcher(`https://en.wikipedia.org/w/api.php?${query}`, {
        headers: { "User-Agent": "Fakeipedia/0.1 (Wikipedia article availability check)" },
        cache: "no-store",
        signal,
      });
      return response.ok ? response.json() : null;
    }

    // Title discovery handles capitalisation without accepting partial matches.
    // Keep alias names here so they can be compared before resolving redirects.
    const suggestions = await request({
      action: "opensearch",
      search: title.trim(),
      namespace: "0",
      limit: "10",
      redirects: "return",
    });
    if (!Array.isArray(suggestions?.[1])) return null;
    const matchingTitle = suggestions[1].find((candidate: unknown) =>
      typeof candidate === "string" && normalizedTitle(candidate) === expectedTitle,
    );
    if (!matchingTitle) return null;

    const data = await request({
      action: "query",
      formatversion: "2",
      prop: "info",
      titles: matchingTitle,
      redirects: "1",
    });
    const pages = data?.query?.pages;
    if (data?.error || !Array.isArray(pages) || pages.length !== 1) return null;

    const page = pages[0];
    if (
      !page || page.ns !== 0 || !(page.pageid > 0) ||
      "missing" in page || "invalid" in page || "redirect" in page ||
      typeof page.title !== "string"
    ) return null;

    let resolvedTitle = matchingTitle;
    const redirects = data.query.redirects ?? [];
    if (!Array.isArray(redirects)) return null;
    for (let i = 0; i < redirects.length; i++) {
      const redirect = redirects.find((entry) => entry?.from === resolvedTitle);
      if (!redirect) break;
      if (typeof redirect.to !== "string" || redirect.tofragment) return null;
      resolvedTitle = redirect.to;
    }
    if (normalizedTitle(page.title) !== normalizedTitle(resolvedTitle)) return null;

    return `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
  } catch {
    // Wikipedia availability must never prevent the local article from loading.
    return null;
  }
}
