import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Organizations ───────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubInstallationId: text('github_installation_id').unique(),
  name: text('name').notNull(),
  plan: text('plan', { enum: ['free', 'team', 'business'] }).default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const organizationsRelations = relations(organizations, ({ many }) => ({
  repositories: many(repositories),
}))

// ─── Repositories ────────────────────────────────────────────────

export const repositories = pgTable('repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .references(() => organizations.id, { onDelete: 'cascade' })
    .notNull(),
  provider: text('provider', { enum: ['github', 'gitlab'] }).default('github').notNull(),
  githubRepoId: text('github_repo_id').unique().notNull(),
  gitlabProjectId: text('gitlab_project_id').unique(),
  fullName: text('full_name').notNull(), // owner/repo
  webUrl: text('web_url'),
  conventionProfile: text('convention_profile'), // YAML config content
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
})

export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [repositories.orgId],
    references: [organizations.id],
  }),
  reviews: many(reviews),
}))

// ─── Reviews ─────────────────────────────────────────────────────

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id')
    .references(() => repositories.id, { onDelete: 'cascade' })
    .notNull(),
  provider: text('provider', { enum: ['github', 'gitlab'] }).default('github').notNull(),
  prNumber: integer('pr_number').notNull(),
  prTitle: text('pr_title'),
  prAuthor: text('pr_author'),
  reviewUrl: text('review_url'),
  summary: text('summary'),
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
    .default('pending')
    .notNull(),
  tokensInput: integer('tokens_input').default(0).notNull(),
  tokensOutput: integer('tokens_output').default(0).notNull(),
  commentsPosted: integer('comments_posted').default(0).notNull(),
  bugsFound: integer('bugs_found').default(0),
  score: integer('score'), // 0–100
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const reviewsRelations = relations(reviews, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [reviews.repoId],
    references: [repositories.id],
  }),
  comments: many(reviewComments),
}))

// ─── Review Comments ─────────────────────────────────────────────

export const reviewComments = pgTable('review_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .references(() => reviews.id, { onDelete: 'cascade' })
    .notNull(),
  file: text('file').notNull(),
  line: integer('line').notNull(),
  severity: text('severity', {
    enum: ['bug', 'suggestion', 'nitpick', 'praise'],
  }).notNull(),
  message: text('message').notNull(),
  suggestion: text('suggestion'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  review: one(reviews, {
    fields: [reviewComments.reviewId],
    references: [reviews.id],
  }),
}))

// ─── Type Exports ────────────────────────────────────────────────

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert

export type Repository = typeof repositories.$inferSelect
export type NewRepository = typeof repositories.$inferInsert

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert

export type ReviewComment = typeof reviewComments.$inferSelect
export type NewReviewComment = typeof reviewComments.$inferInsert

// ─── Better Auth Schema ──────────────────────────────────────────

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('emailVerified').notNull(),
	image: text('image'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull()
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp('expiresAt').notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull(),
	ipAddress: text('ipAddress'),
	userAgent: text('userAgent'),
	userId: text('userId').notNull().references(() => user.id)
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text('accountId').notNull(),
	providerId: text('providerId').notNull(),
	userId: text('userId').notNull().references(() => user.id),
	accessToken: text('accessToken'),
	refreshToken: text('refreshToken'),
	idToken: text('idToken'),
	accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
	refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('createdAt').notNull(),
	updatedAt: timestamp('updatedAt').notNull()
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expiresAt').notNull(),
	createdAt: timestamp('createdAt'),
	updatedAt: timestamp('updatedAt')
});

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert

// ─── User → Organization membership ─────────────────────────────
// Defined after both `user` and `organizations` to avoid forward-reference issues

export const userOrganizations = pgTable('user_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'member'] }).default('owner').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const userOrganizationsRelations = relations(userOrganizations, ({ one }) => ({
  organization: one(organizations, {
    fields: [userOrganizations.orgId],
    references: [organizations.id],
  }),
  user: one(user, {
    fields: [userOrganizations.userId],
    references: [user.id],
  }),
}))

export type UserOrganization = typeof userOrganizations.$inferSelect
export type NewUserOrganization = typeof userOrganizations.$inferInsert
