# AI Review Bot for VS Code

Review the current file or selected code using your self-hosted AI Review Bot.

1. Start the dashboard following the [self-hosting guide](https://github.com/Sakeerin/ai-code-review-bot/blob/main/docs/SELF_HOSTING.md).
2. Open **AI Review Bot: Configure Settings** and set the API URL and your server's review API key.
3. Run **AI Review Bot: Review Current File** or select text and run **Review Selected Code**.

File reviews compare the current editor buffer, including unsaved changes, against
Git HEAD. Unchanged and Git-ignored files are skipped. New files are reviewed as additions.
Automatic reviews on save are optional and disabled by default.

Selected code is sent to your server and its configured AI provider. Review suggestions
before applying them. The extension is distributed under the MIT license; bundled
third-party notices are included in `THIRD_PARTY_NOTICES.txt`.
