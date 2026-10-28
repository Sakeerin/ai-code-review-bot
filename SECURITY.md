# Security policy

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting form](https://github.com/Sakeerin/ai-code-review-bot/security/advisories/new).
Do not open a public issue or pull request containing exploit details, credentials,
private repository code, or personal data.

Include the affected commit/version, component, impact, prerequisites, and minimal
reproduction steps with synthetic data. Redact tokens, webhook signatures, and
customer information. If private reporting is temporarily unavailable, open an
issue requesting a private contact channel without disclosing the vulnerability.

Reports are reviewed on a best-effort basis. The project does not currently offer
a bug bounty or a guaranteed response time.

## Supported code

CI runs `bun run audit:security` against the complete lockfile, including development
dependencies, and rejects high or critical advisories and registry failures. Lower
severity advisories remain visible in the job output and require periodic review.
The current remaining advisories concern transitive OpenTelemetry instrumentation,
esbuild's development server, and uuid's caller-supplied buffers; passing this gate
does not mean the dependency tree has no advisories.

Root dependency overrides keep patched PostCSS, Rollup, Undici, busboy, MSAL,
WebSocket and Zod versions in older dependency trees. Recheck these overrides when
upgrading their parents; test both app builds, webhook bundling and VS Code packaging
before changing them. The AI package uses the current Zod API directly.

Security fixes target the latest code on `main`. There are no maintained release
branches or promised backports. Operators should review changes and migrations
before upgrading their deployment.

## Operating your own deployment

- Use separate development and production credentials. Configure every provider's
  webhook secret and give tokens only the permissions they need.
- Keep `.env*`, `.dev.vars*`, private keys, database dumps, and local logs private.
  Only sanitized example configuration belongs in Git. If a credential is exposed,
  revoke/rotate it at its issuer; deleting it from the latest commit is insufficient.
- Configure HTTPS, a strong `BETTER_AUTH_SECRET`, database access controls, and
  the intended dashboard URL. Replace the example Docker PostgreSQL password.
- Protect `REVIEW_API_KEY` as a server credential. The current diff endpoint uses
  a shared key; keep it within the deployment's trust boundary.
- MCP tools run with the configured database and AI credentials. Share access
  only with trusted local clients.
- AI reviews send selected diffs, configuration, and code samples to configured
  external AI providers. Fallback can send the same input to more than one provider.
  Review the providers' terms and settings before using confidential code.
- Cloud-hosted Trigger.dev workers also process review data. Docker hosts the
  dashboard, webhook receiver, and database; it does not include a Trigger.dev
  server or an offline AI model.
- Reviews, summaries, and comments are stored in PostgreSQL and may be sent to
  enabled Slack/email integrations. Operators control access, backups, retention,
  monitoring, and deletion for their deployment.

AI output may miss defects or suggest incorrect changes. Review it before applying
changes, and keep normal human review and automated checks in place.
