CREATE TABLE "article_question_sets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_question_sets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_article_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"questions" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "article_questions_source_hash_unique" UNIQUE("source_article_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "lore_contributions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lore_contributions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"wiki" text NOT NULL,
	"target_slug" text NOT NULL,
	"source_article_id" integer,
	"source_slug" text NOT NULL,
	"source_title" text NOT NULL,
	"question_set_id" integer,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"status" text NOT NULL,
	"article_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lore_contributions_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "article_question_sets" ADD CONSTRAINT "article_question_sets_source_article_id_articles_id_fk" FOREIGN KEY ("source_article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lore_contributions" ADD CONSTRAINT "lore_contributions_source_article_id_articles_id_fk" FOREIGN KEY ("source_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lore_contributions" ADD CONSTRAINT "lore_contributions_question_set_id_article_question_sets_id_fk" FOREIGN KEY ("question_set_id") REFERENCES "public"."article_question_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lore_contributions" ADD CONSTRAINT "lore_contributions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;