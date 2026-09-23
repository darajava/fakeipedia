ALTER TABLE "lore_contributions" DROP CONSTRAINT "lore_contributions_question_set_id_article_question_sets_id_fk";--> statement-breakpoint
DROP TABLE "article_question_sets";--> statement-breakpoint
ALTER TABLE "generation_intents" DROP COLUMN "question";--> statement-breakpoint
ALTER TABLE "lore_contributions" DROP COLUMN "question_set_id";--> statement-breakpoint
ALTER TABLE "lore_contributions" DROP COLUMN "question";
