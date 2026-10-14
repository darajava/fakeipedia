import type { GenerationProgress } from "../lib/generation-progress";
import {
  pgTable,
  integer,
  text,
  timestamp,
  unique,
  jsonb,
  uuid,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Historical billing records: retained for existing orders and in-flight settlement only.
// No account creation, credit purchases, or new credit reservations are exposed.
export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  email: text("email").notNull().unique(),

  name: text("name"),

  // Opt-in public attribution, independent of private billing or identity names.
  handle: text("handle"),

  clerkId: text("clerk_id").unique(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const articles = pgTable("articles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  wiki: text("wiki").notNull(),

  slug: text("slug").notNull(),

  title: text("title").notNull(),

  content: text("content").notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [unique("articles_wiki_slug_unique").on(table.wiki, table.slug)]);

export const articleRevisions = pgTable("article_revisions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id, {
      onDelete: "cascade",
    }),

  title: text("title").notNull(),

  content: text("content").notNull(),

  editorId: integer("editor_id").references(() => users.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loreContributions = pgTable("lore_contributions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid("request_id").notNull().unique(),
  wiki: text("wiki").notNull(),
  targetSlug: text("target_slug").notNull(),
  sourceArticleId: integer("source_article_id").references(() => articles.id, { onDelete: "set null" }),
  sourceSlug: text("source_slug").notNull(),
  sourceTitle: text("source_title").notNull(),
  answer: text("answer").notNull(),
  status: text("status").$type<"generating" | "succeeded" | "failed">().notNull(),
  articleId: integer("article_id").references(() => articles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Drafts are immutable once saved. Only a hash of the browser's capability is stored.
export const generationIntents = pgTable("generation_intents", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  wiki: text("wiki").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  sourceSlug: text("source_slug").notNull(),
  answer: text("answer").notNull(),
  contributionId: integer("contribution_id").references(() => loreContributions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "restrict" }),
  intentId: uuid("intent_id").references(() => generationIntents.id, { onDelete: "restrict" }),
  // Persisted request identifier keeps checkout retries idempotent.
  requestId: uuid("request_id").notNull().unique(),
  kind: text("kind").$type<"article" | "credits">().notNull(),
  status: text("status").$type<"pending" | "paid" | "refund_pending" | "refunded" | "cancelled">().notNull().default("pending"),
  priceId: text("price_id").notNull(),
  creditQuantity: integer("credit_quantity").notNull().default(0),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  stripeSessionId: text("stripe_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeRefundId: text("stripe_refund_id"),
  checkoutUrl: text("checkout_url"),
  refundError: text("refund_error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [index("orders_user_idx").on(t.userId), index("orders_intent_idx").on(t.intentId), index("orders_reconcile_idx").on(t.status, t.checkedAt),
  check("orders_kind_check", sql`${t.kind} IN ('article', 'credits')`),
  check("orders_credit_owner_check", sql`${t.kind} <> 'credits' OR (${t.userId} IS NOT NULL AND ${t.creditQuantity} > 0)`),
  check("orders_article_intent_check", sql`${t.kind} <> 'article' OR ${t.intentId} IS NOT NULL`),
]);

export const creditAccounts = pgTable("credit_accounts", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "restrict" }),
  balance: integer("balance").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
}, (t) => [check("credits_nonnegative", sql`${t.balance} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.balance}`)]);

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  intentId: uuid("intent_id").notNull().unique().references(() => generationIntents.id, { onDelete: "restrict" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").unique().references(() => purchaseOrders.id, { onDelete: "restrict" }),
  funding: text("funding").$type<"article" | "credit" | "freebie">().notNull(),
  status: text("status").$type<"queued" | "running" | "succeeded" | "failed" | "superseded">().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: uuid("lease_token"),
  leasedUntil: timestamp("leased_until", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  articleId: integer("article_id").references(() => articles.id, { onDelete: "set null" }),
  progress: jsonb("progress").$type<GenerationProgress>(),
  progressUpdatedAt: timestamp("progress_updated_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("jobs_poll_idx").on(t.status, t.availableAt),
  check("jobs_funding_check", sql`(${t.funding} = 'credit' AND ${t.userId} IS NOT NULL AND ${t.orderId} IS NULL) OR (${t.funding} = 'article' AND ${t.orderId} IS NOT NULL) OR (${t.funding} = 'freebie' AND ${t.userId} IS NULL AND ${t.orderId} IS NULL)`),
]);

export const creditTransactions = pgTable("credit_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").references(() => purchaseOrders.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "restrict" }),
  key: text("key").notNull().unique(),
  delta: integer("delta").notNull(),
  reservedDelta: integer("reserved_delta").notNull().default(0),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
