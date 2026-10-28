CREATE TABLE "review_dispatch_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_until" timestamp,
	"dispatched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_dispatch_outbox" ADD CONSTRAINT "review_dispatch_outbox_id_review_reservations_reservation_key_fk" FOREIGN KEY ("id") REFERENCES "public"."review_reservations"("reservation_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_dispatch_pending_idx" ON "review_dispatch_outbox" USING btree ("dispatched_at","next_attempt_at");
--> statement-breakpoint
-- Apply the advertised Free limit to existing installations as well as new ones.
WITH ranked AS (
  SELECT r.id, ROW_NUMBER() OVER (PARTITION BY r.org_id ORDER BY r.created_at, r.id) AS position
  FROM repositories r JOIN organizations o ON o.id = r.org_id
  WHERE COALESCE(o.plan, 'free') = 'free' AND r.is_active = true
)
UPDATE repositories SET is_active = false WHERE id IN (SELECT id FROM ranked WHERE position > 1);
