CREATE INDEX "repositories_org_id_idx" ON "repositories" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "repositories_full_name_idx" ON "repositories" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "reviews_repo_id_idx" ON "reviews" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reviews_analytics_idx" ON "reviews" USING btree ("repo_id","status","created_at");--> statement-breakpoint
CREATE INDEX "user_orgs_user_id_idx" ON "user_organizations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_orgs_org_id_idx" ON "user_organizations" USING btree ("org_id");