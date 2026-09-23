ALTER TABLE "generation_jobs" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "progress_updated_at" timestamp with time zone;