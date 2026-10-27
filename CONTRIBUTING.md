# Contributing

Contributions to AI Review Bot are welcome: bug fixes, provider integrations,
documentation, translations, and reproducible bug reports. English and Thai are
both welcome in issues and pull requests.

Read the [Code of Conduct](CODE_OF_CONDUCT.md). Report security vulnerabilities
privately through [SECURITY.md](SECURITY.md).

## Start without service credentials

Install Git, Node.js 22 or newer, and Bun 1.3.0 (the version used in CI). Fork the
repository, clone your fork, and create a branch for your change:

```bash
git clone https://github.com/YOUR_USERNAME/ai-code-review-bot.git
cd ai-code-review-bot
bun install --frozen-lockfile
git switch -c fix/describe-your-change
bun test tests
bun run lint
bun run typecheck
```

The regression tests use an in-memory PostgreSQL database and replace external
service calls. They do not require a real database, AI keys, a GitHub App, Stripe,
or Trigger.dev credentials. Git must be available for the extension regression test.

For local development with real services, follow [Self-hosting](docs/SELF_HOSTING.md)
or the Thai [local guide](RUN-LOCAL.md). Use accounts and credentials you control.

## Before making a larger change

Search [existing issues](https://github.com/Sakeerin/ai-code-review-bot/issues) and
open a feature request to explain the problem and approach. Small fixes and
documentation corrections can go straight to a pull request.

## Working on code

- Keep changes focused and follow the surrounding TypeScript style.
- Add a regression test for behavior changes where it demonstrates the bug or
  protects a meaningful boundary. Documentation-only changes do not need new tests.
- Format the files you change with `bun run prettier --write path/to/file`.
- Use `bun install` when changing dependencies and include the updated `bun.lock`.
- For database changes, generate a migration with `bun run db:generate`, review
  its SQL, and include the migration and Drizzle metadata. Avoid rewriting released
  migrations. Test with a disposable database, never shared production data.
- Keep secrets, real webhook payloads, private repository code, and generated
  artifacts out of commits and issue reports.

## Validation

Run the checks affected by your change before opening a pull request:

```bash
bun run lint
bun run typecheck
bun test tests
bun run --cwd apps/dashboard build
```

A dashboard build requires a database connection string and an auth secret to be
configured; it does not need a running database for static generation. The CI
workflow demonstrates build-only placeholder values. Test billing separately with
`bun run billing:verify` using Stripe test credentials and prices; this command
contacts Stripe and is not part of the offline test suite.

If you change deployment files, also run `docker compose config --quiet` and build
both Dockerfiles. CI builds the Linux standalone dashboard image; normal Windows
builds omit standalone output because it requires symlink privileges.

## Pull requests

Explain the problem, resulting behavior, and checks you ran. Link an issue when
one exists, and include screenshots for visible UI changes. Mention migrations,
new environment variables, and rollout steps when relevant. Describe any check
you could not run and why.

The project is maintained by [Sakeerin](https://github.com/Sakeerin). Review timing
depends on maintainer availability; avoid including release dates or support
guarantees in a contribution without prior agreement.

## License

By submitting a contribution, you agree that your contribution is provided under
the repository's [MIT License](LICENSE). Only contribute material you have the
right to share, and preserve applicable third-party notices. Dependency licenses
remain the responsibility of their respective authors.
