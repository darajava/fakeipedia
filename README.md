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

Generating an article from its matching `stub-<article-slug>` source requests a featured wiki overview of 2,500–3,500 words with five images. The stub supplies the world brief, broad subject coverage and image plan. After editing stubs, import them again so generation uses the updated database copies.

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
