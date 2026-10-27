CREATE TABLE "review_runs" (
	"review_key" text PRIMARY KEY NOT NULL,
	"repo_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gitlab_namespace" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "bitbucket_workspace" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "review_key" text;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_gitlab_namespace_unique" UNIQUE("gitlab_namespace");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_bitbucket_workspace_unique" UNIQUE("bitbucket_workspace");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_review_key_unique" UNIQUE("review_key");
--> statement-breakpoint
-- Preserve existing plans only when an organization has one unambiguous provider namespace.
-- Mixed organizations are deliberately not claimed by matching their display name.
WITH candidates AS (
  SELECT r.org_id, min(split_part(r.full_name, '/', 1)) AS namespace
  FROM repositories r JOIN organizations o ON o.id = r.org_id
  WHERE o.github_installation_id IS NULL
  GROUP BY r.org_id
  HAVING bool_and(r.provider = 'gitlab') AND count(DISTINCT split_part(r.full_name, '/', 1)) = 1
), unambiguous AS (
  SELECT * FROM candidates WHERE namespace IN (
    SELECT namespace FROM candidates GROUP BY namespace HAVING count(*) = 1
  )
)
UPDATE organizations o SET gitlab_namespace = u.namespace FROM unambiguous u WHERE o.id = u.org_id;
--> statement-breakpoint
WITH candidates AS (
  SELECT r.org_id, min(split_part(r.full_name, '/', 1)) AS namespace
  FROM repositories r JOIN organizations o ON o.id = r.org_id
  WHERE o.github_installation_id IS NULL
  GROUP BY r.org_id
  HAVING bool_and(r.provider = 'bitbucket') AND count(DISTINCT split_part(r.full_name, '/', 1)) = 1
), unambiguous AS (
  SELECT * FROM candidates WHERE namespace IN (
    SELECT namespace FROM candidates GROUP BY namespace HAVING count(*) = 1
  )
)
UPDATE organizations o SET bitbucket_workspace = u.namespace FROM unambiguous u WHERE o.id = u.org_id;
