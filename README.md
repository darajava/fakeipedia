# Fakeipedia

An encyclopedia of imaginary worlds. Each subdirectory of `wiki-files` is a separate wiki:

```text
wiki-files/
  zorg/
    zorg.md
    helion-system.md
    images/
      helion-system_orbital-overview.png
  roman-empire/
    rome.md
    images/
```

Use lowercase, hyphenated wiki directory names. The first directory determines the wiki; an article's optional frontmatter `slug` determines its article slug, falling back to its filename. Article names and image filenames can be reused in different wikis.

Articles use `/w/WIKI/ARTICLE`, for example `/w/zorg/helion-system`. `/` lists imported wikis, and `/w/zorg` lists Zorg's articles. Existing `/wiki/ARTICLE` URLs redirect to Zorg.

Homepage cards read their display title and subtitle directly from the frontmatter of each wiki's `stub-*.md` file. Keep one stub at the top level of each wiki directory. Editing these fields updates the homepage without reimporting or regenerating articles:

```markdown
---
title: ASI
subtitle: In 2048, ASI rules Earth and humanity struggles to survive.
slug: stub-asi
---
```

Each card opens the stub's last linked article (the same target used for initial page generation). The title can differ from the folder name and the target article's title. Wikis without a local stub retain their folder-derived title and article-list link.

## Article graph

Open **Article graph** from an article's navigation, or **Explore the article graph** from the wiki's article list. The graph lives at `/w/WIKI/explore/graph`, so articles named `graph` or `explore` keep their URLs.

Drag an article node with gentle spring resistance; a quick release carries its momentum, which fades with friction. Connected articles subtly follow the movement. This interaction uses a bounded local spring system (the dragged article and up to 48 actual neighbours), keeping large wikis responsive. Holding still before release stops the fling, and reduced-motion preferences disable inertia. Drag the background to pan, scroll or pinch to zoom, and click a node to read its article. Search can find and focus any article, including isolated articles. Keyboard controls are arrow keys to pan, `+`/`-` to zoom, `Home` to fit the graph, and `Enter` to open the focused article. The searchable article links also work without WebGL 2.

Every saved article is a node. Connections come from rendered links inside the current wiki, including Markdown reference links, HTML anchors, and clickable Markdown links in preformatted tables and diagrams. Inline code, literal HTML inside code blocks, image sources, external links and links to other wikis do not create connections. Repeated links from one article to the same target count once. Missing targets appear only as short red lines extending from their source, and self-links appear as loops.

For large wikis, a read-only database cursor streams compact records in batches of 128. A consistent snapshot avoids mixing article versions during loading. A bounded server cache retains up to four graphs within an estimated 128 MiB total budget; snapshots may be up to one minute old. Refreshing an expired snapshot checks database row revisions and reads/parses only new or changed article bodies. A cold load still needs to read and parse the wiki's content; the cache is per server process and is lost on restart.

The browser parses the stream, builds typed adjacency buffers, runs bounded spatial forces, searches and handles picking in a Web Worker. WebGL 2 batches nodes, links, missing-link stubs and self-loops into four draw calls, with positions interpolated on the GPU. Camera movement updates uniforms rather than rebuilding all edges. Dense overview views sample actual connections to limit overlapping line drawing; all article nodes remain visible, an on-screen hint identifies the simplified view, and zooming in restores more link detail. Layout work yields between small batches, stops after settling, and pauses in hidden tabs. Reduced-motion preferences disable animated layout transitions. The article list is paginated at 100 entries to avoid rendering a 100,000-item list on the way to the graph.

`npm test` includes a synthetic 100,000-article / 1,000,000-link graph check, link-extraction cases, and database-stream/cache/cancellation tests. The synthetic records stay in test memory and are never inserted into the wiki database. Device frame rates and a cold database load are separate from these unit tests.

## Run locally

Configure `DATABASE_URL` in `.env`, then run:

```sh
npm install
npm run db:migrate
npm run import:wiki
npm run dev
```

The wiki migration assigns all existing single-wiki articles to `zorg` while preserving their IDs and revisions. Apply migrations before running the updated app or importer.

To add another world, create its directory with at least one Markdown article and run `npm run import:wiki`. The import updates articles by wiki and slug. Images are served directly from `wiki-files/WIKI/images/` through `/wiki-images/WIKI/`; there is no second copy in `public`.

Wiki Markdown files and image directories are ignored by Git. Keep `wiki-files` available on the server when running the app.

Use `[[Article name]]` or `[[Article name|display text]]` for links within a wiki, and `./images/filename.png` for images. Explicit links such as `[Rome](/w/roman-empire/rome)` can point to other wikis. Legacy `/wiki/ARTICLE` links inside articles resolve within the current wiki.

Article generation uses Gemini 3.8 Flash (`gemini-3.8-flash`) with high reasoning and only the current wiki's catalogue and source article as context. It saves new Markdown and images inside that wiki's directory. Text generation requires `GEMINI_API_KEY` in `.env`; image generation requires `OPENAI_API_KEY`.

Generating an article from a stub requests a featured wiki overview with five images. The stub supplies the world brief, broad subject coverage and image plan. Its last article link determines the overview target, including when earlier links or a target section are present.

## Generate initial pages from stubs

Run `npm run generate:stubs -- --dry-run` to preview the target page for every stub without connecting to the database or calling generation APIs.

Run `npm run generate:stubs` to load the latest stubs from `wiki-files` and generate their initial pages one at a time, using the same text and image generation as the app. No running web server or separate import is needed. Configure `DATABASE_URL` and `GEMINI_API_KEY` in `.env`, apply database migrations first, and set `OPENAI_API_KEY` for images.

Stubs are articles whose slug begins with `stub-`. The last link supplies the target title and slug; for `[[Article name|display text]]`, the title is `Article name`. Existing target pages in the database or local Markdown files are preserved and skipped. Missing or invalid target links stop the run before any changes. Generation failures are reported and the remaining stubs continue; the command exits unsuccessfully if any page failed. Optional image failures are reported while keeping the saved page.

## Reset wiki content

Run `npm run reset:wiki -- --dry-run` to preview the reset without connecting to the database or changing files.

Run `npm run reset:wiki` to empty `articles`, `article_revisions` and `users` in the database configured by `DATABASE_URL`, and reset their IDs. The schema and migration history remain intact. The script deletes non-stub Markdown files, image files and the contents of image directories under `wiki-files`, preserving every `stub-*.md` file and all wiki folders. It does not follow symbolic links.

Stop article generation before resetting. Files are staged and restored if the database reset fails. The database is left empty; run `npm run import:wiki` afterwards to reload the preserved stubs.

## Validation

```sh
npm test
npm run lint
npm run build
```
