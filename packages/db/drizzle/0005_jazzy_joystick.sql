ALTER TABLE "organizations" ADD COLUMN "slack_webhook_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email_report_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email_report_recipients" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "bitbucket_repo_id" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_bitbucket_repo_id_unique" UNIQUE("bitbucket_repo_id");