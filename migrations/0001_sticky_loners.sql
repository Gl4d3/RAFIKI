ALTER TABLE "analysis_jobs" ADD COLUMN "attached_sources" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "sms_text" text;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "annotation" text;