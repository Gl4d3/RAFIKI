import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const onboardingStageEnum = pgEnum("onboarding_stage", [
  "upload",
  "analyzing",
  "reveal",
  "gap_filling",
  "priority_stack",
  "complete",
]);

export const transactionDirectionEnum = pgEnum("transaction_direction", [
  "credit",
  "debit",
]);

export const tierEnum = pgEnum("tier", ["1", "2", "3", "4", "unknown"]);

export const entityCategoryEnum = pgEnum("entity_category", [
  "rent",
  "utilities",
  "transport",
  "food",
  "family",
  "chama",
  "business",
  "savings",
  "income",
  "merchant",
  "entertainment",
  "healthcare",
  "education",
  "one_time",
  "unknown",
]);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  onboardingStage: onboardingStageEnum("onboarding_stage").default("upload"),
  onboardingJobId: text("onboarding_job_id"),
  safeBuffer: integer("safe_buffer").default(2000),
  financialHealthScore: integer("financial_health_score"),
  estimatedBalance: integer("estimated_balance"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transactions table
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  date: timestamp("date").notNull(),
  amount: real("amount").notNull(),
  direction: transactionDirectionEnum("direction").notNull(),
  counterparty: text("counterparty").notNull(),
  reference: text("reference"),
  balance: real("balance"),
  category: entityCategoryEnum("category").default("unknown"),
  tier: tierEnum("tier").default("unknown"),
  isRecurring: boolean("is_recurring").default(false),
  isSalary: boolean("is_salary").default(false),
  rawText: text("raw_text"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Known entities / knowledge graph
export const entities = pgTable("entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  category: entityCategoryEnum("category").default("unknown"),
  tier: tierEnum("tier").default("unknown"),
  isRecurring: boolean("is_recurring").default(false),
  monthlyAmount: real("monthly_amount"),
  frequency: text("frequency"),
  occurrences: integer("occurrences").default(1),
  isAutoResolved: boolean("is_auto_resolved").default(false),
  isUserResolved: boolean("is_user_resolved").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Priority stack items
export const priorityStackItems = pgTable("priority_stack_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  rank: integer("rank").notNull(),
  label: text("label").notNull(),
  monthlyAmount: real("monthly_amount"),
  tier: tierEnum("tier").default("unknown"),
  entityId: varchar("entity_id").references(() => entities.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Analysis jobs (for async processing)
export const analysisJobs = pgTable("analysis_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").default(0),
  progressLabel: text("progress_label").default("Starting..."),
  transactionCount: integer("transaction_count"),
  unknownCount: integer("unknown_count"),
  revealMessage: text("reveal_message"),
  summaryData: jsonb("summary_data"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export const insertEntitySchema = createInsertSchema(entities).omit({
  id: true,
  createdAt: true,
});

export const insertPriorityStackItemSchema = createInsertSchema(
  priorityStackItems
).omit({ id: true, createdAt: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type PriorityStackItem = typeof priorityStackItems.$inferSelect;
export type AnalysisJob = typeof analysisJobs.$inferSelect;

// Summary data shape (stored as JSON)
export interface AnalysisSummary {
  totalCredits: number;
  totalDebits: number;
  estimatedSalary: number;
  salarySource: string;
  topCategories: { category: string; total: number }[];
  recurringObligations: {
    name: string;
    amount: number;
    category: string;
    tier: string;
  }[];
  unknownEntities: {
    entityId: string;
    name: string;
    amount: number;
    occurrences: number;
    lastSeen: string;
  }[];
}
