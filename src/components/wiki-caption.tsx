import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { articleLink, articlePath, prepareWikiLinks } from "../lib/wiki";

type WikiCaptionProps = {
  text: string;
  wiki: string;
  slug: string;
  existingSlugs: ReadonlySet<string>;
};

/** Captions use inline Markdown, with the same article destinations as the body. */
export function WikiCaption({ text, wiki, slug, existingSlugs }: WikiCaptionProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={["a", "em", "strong", "del", "code", "br"]}
      unwrapDisallowed
      components={{
        a({ href, children }) {
          const link = articleLink(href, wiki);
          if (link?.slug.startsWith("stub-")) return <>{children}</>;
          const missing = link?.wiki === wiki && link.slug !== slug && !existingSlugs.has(link.slug);
          const destination = missing && link
            ? `${articlePath(wiki, link.slug)}/generate?title=${encodeURIComponent(link.title)}&source=${encodeURIComponent(slug)}${link.hash}`
            : link?.href ?? href;
          return <a href={destination} className={missing ? "wiki-link-missing" : undefined}>{children}</a>;
        },
      }}
    >
      {prepareWikiLinks(text, wiki)}
    </ReactMarkdown>
  );
}
