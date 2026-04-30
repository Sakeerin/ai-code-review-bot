CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_key" text NOT NULL,
	"month_key" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"overage_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_org_month" UNIQUE("org_key","month_key")
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
