CREATE TABLE "notification_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp,
	"delivered_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reservations" (
	"reservation_key" text PRIMARY KEY NOT NULL,
	"org_key" text NOT NULL,
	"month_key" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "review_reservations_org_month_idx" ON "review_reservations" USING btree ("org_key","month_key");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");
--> statement-breakpoint
-- Reconcile legacy counters that counted duplicate deliveries instead of reviews.
-- Apply migrations while review workers are stopped so in-flight legacy jobs can finish first.
WITH usage AS (
  SELECT o.id, o.plan,
    CASE WHEN o.github_installation_id IS NOT NULL THEN 'gh:' || o.github_installation_id
         WHEN o.gitlab_namespace IS NOT NULL THEN 'gl:' || o.gitlab_namespace
         WHEN o.bitbucket_workspace IS NOT NULL THEN 'bb:' || o.bitbucket_workspace END AS org_key,
    rl.month_key,
    count(v.id) FILTER (WHERE v.status = 'completed' AND to_char(COALESCE(v.completed_at, v.created_at), 'YYYY-MM') = rl.month_key)::int AS used
  FROM organizations o
  JOIN rate_limits rl ON rl.org_key = CASE
    WHEN o.github_installation_id IS NOT NULL THEN 'gh:' || o.github_installation_id
    WHEN o.gitlab_namespace IS NOT NULL THEN 'gl:' || o.gitlab_namespace
    WHEN o.bitbucket_workspace IS NOT NULL THEN 'bb:' || o.bitbucket_workspace END
  LEFT JOIN repositories r ON r.org_id = o.id
  LEFT JOIN reviews v ON v.repo_id = r.id
  GROUP BY o.id, rl.month_key
)
UPDATE rate_limits rl SET used = u.used, plan = u.plan,
  overage_used = CASE WHEN u.plan = 'team' THEN GREATEST(0, u.used - 500) ELSE 0 END,
  updated_at = now()
FROM usage u WHERE rl.org_key = u.org_key AND rl.month_key = u.month_key;
