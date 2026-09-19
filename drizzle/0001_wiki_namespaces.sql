ALTER TABLE "articles" DROP CONSTRAINT "articles_slug_unique";--> statement-breakpoint
-- All articles in the original single-wiki database belong to Zorg.
ALTER TABLE "articles" ADD COLUMN "wiki" text DEFAULT 'zorg' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "wiki" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_wiki_slug_unique" UNIQUE("wiki","slug");
