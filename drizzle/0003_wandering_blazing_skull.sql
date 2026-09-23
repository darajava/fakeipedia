CREATE TABLE "credit_accounts" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credits_nonnegative" CHECK ("credit_accounts"."balance" >= 0 AND "credit_accounts"."reserved" >= 0 AND "credit_accounts"."reserved" <= "credit_accounts"."balance")
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"order_id" uuid,
	"job_id" uuid,
	"key" text NOT NULL,
	"delta" integer NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "generation_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"wiki" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"source_slug" text NOT NULL,
	"question" text,
	"answer" text NOT NULL,
	"contribution_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"user_id" integer,
	"order_id" uuid,
	"funding" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"leased_until" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"article_id" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "generation_jobs_intent_id_unique" UNIQUE("intent_id"),
	CONSTRAINT "generation_jobs_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "jobs_funding_check" CHECK (("generation_jobs"."funding" = 'credit' AND "generation_jobs"."user_id" IS NOT NULL AND "generation_jobs"."order_id" IS NULL) OR ("generation_jobs"."funding" = 'article' AND "generation_jobs"."order_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer,
	"intent_id" uuid,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"price_id" text NOT NULL,
	"credit_quantity" integer DEFAULT 0 NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_refund_id" text,
	"checkout_url" text,
	"refund_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "purchase_orders_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "purchase_orders_stripe_session_id_unique" UNIQUE("stripe_session_id"),
	CONSTRAINT "purchase_orders_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "orders_kind_check" CHECK ("purchase_orders"."kind" IN ('article', 'credits')),
	CONSTRAINT "orders_credit_owner_check" CHECK ("purchase_orders"."kind" <> 'credits' OR ("purchase_orders"."user_id" IS NOT NULL AND "purchase_orders"."credit_quantity" > 0)),
	CONSTRAINT "orders_article_intent_check" CHECK ("purchase_orders"."kind" <> 'article' OR "purchase_orders"."intent_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_id" text;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_intents" ADD CONSTRAINT "generation_intents_contribution_id_lore_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."lore_contributions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_intent_id_generation_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."generation_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_intent_id_generation_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."generation_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_poll_idx" ON "generation_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "purchase_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_intent_idx" ON "purchase_orders" USING btree ("intent_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id");