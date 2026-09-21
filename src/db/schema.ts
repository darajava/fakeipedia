import {
  pgTable,
  integer,
  text,
  timestamp,
  unique,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  email: text("email").notNull().unique(),

  name: text("name"),

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

export type LinkQuestion = { slug: string; title: string; question: string };

export const articleQuestionSets = pgTable("article_question_sets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceArticleId: integer("source_article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  questions: jsonb("questions").$type<LinkQuestion[]>().notNull(),
  status: text("status").$type<"generating" | "ready" | "failed">().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [unique("article_questions_source_hash_unique").on(table.sourceArticleId, table.contentHash)]);

export const loreContributions = pgTable("lore_contributions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid("request_id").notNull().unique(),
  wiki: text("wiki").notNull(),
  targetSlug: text("target_slug").notNull(),
  sourceArticleId: integer("source_article_id").references(() => articles.id, { onDelete: "set null" }),
  sourceSlug: text("source_slug").notNull(),
  sourceTitle: text("source_title").notNull(),
  questionSetId: integer("question_set_id").references(() => articleQuestionSets.id, { onDelete: "set null" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  status: text("status").$type<"generating" | "succeeded" | "failed">().notNull(),
  articleId: integer("article_id").references(() => articles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
