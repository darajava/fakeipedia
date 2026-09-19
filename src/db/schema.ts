import {
  pgTable,
  integer,
  text,
  boolean,
  timestamp,
  unique,
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

  isPremium: boolean("is_premium").notNull().default(false),

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
