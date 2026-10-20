# Security policy

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately instead: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. You'll get a reply as soon as a maintainer can look at it, and credit in the release notes if you'd like.

Security fixes go into the latest release.

## How Faro protects you

- **API keys and sign-ins** are encrypted with the operating system's keychain (Electron `safeStorage`) and only ever used in the main process — the editor UI never sees them.
- **Your own Claude Code / Codex** sign in with their own tools; Faro never handles those credentials. Claude Code runs with only Faro's tools (no shell, file or web access); Codex runs in its read-only sandbox.
- **Faro's MCP server** listens on `127.0.0.1` only, requires a bearer token, and refuses requests from web pages. It's off until you turn it on.
- **Code written by an AI** (Blender scripts) waits for your explicit approval before it runs.
- **Media access** goes through Faro's own `lumen-media://` protocol, which only serves files you imported or that an open project references.
- **Exports and saves** always go where you choose in a system dialog.
