CREATE TYPE "public"."entity_category" AS ENUM('rent', 'utilities', 'transport', 'food', 'family', 'chama', 'business', 'savings', 'income', 'merchant', 'entertainment', 'healthcare', 'education', 'one_time', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."onboarding_stage" AS ENUM('upload', 'analyzing', 'reveal', 'gap_filling', 'priority_stack', 'complete');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('1', '2', '3', '4', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"progress_label" text DEFAULT 'Starting...',
	"transaction_count" integer,
	"unknown_count" integer,
	"reveal_message" text,
	"summary_data" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" "entity_category" DEFAULT 'unknown',
	"tier" "tier" DEFAULT 'unknown',
	"is_recurring" boolean DEFAULT false,
	"monthly_amount" real,
	"frequency" text,
	"occurrences" integer DEFAULT 1,
	"is_auto_resolved" boolean DEFAULT false,
	"is_user_resolved" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "priority_stack_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"rank" integer NOT NULL,
	"label" text NOT NULL,
	"monthly_amount" real,
	"tier" "tier" DEFAULT 'unknown',
	"entity_id" varchar,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"amount" real NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"counterparty" text NOT NULL,
	"reference" text,
	"balance" real,
	"category" "entity_category" DEFAULT 'unknown',
	"tier" "tier" DEFAULT 'unknown',
	"is_recurring" boolean DEFAULT false,
	"is_salary" boolean DEFAULT false,
	"raw_text" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"display_name" text,
	"onboarding_stage" "onboarding_stage" DEFAULT 'upload',
	"onboarding_job_id" text,
	"safe_buffer" integer DEFAULT 2000,
	"financial_health_score" integer,
	"estimated_balance" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_stack_items" ADD CONSTRAINT "priority_stack_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_stack_items" ADD CONSTRAINT "priority_stack_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;