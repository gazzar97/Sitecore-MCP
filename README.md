# Sitecore MCP (Local Instances)

An MCP (Model Context Protocol) server that lets AI assistants (Claude Code, Claude Desktop, VS Code, Cursor, etc.) inspect and work with **locally running Sitecore instances** used for development.

> Status: **Phase 1 (read) and Phase 3 (guarded create/update/delete, off by default)** implemented and verified against a local Sitecore 10.4 IIS instance. See [Getting started](docs/07-getting-started.md).

## Quick start

```bash
npm install && npm run build
cp sitecore-mcp.config.example.json ~/.sitecore-mcp/config.json   # then edit
PROJECTA_SC_PASSWORD=<password> npm run ping
```

## Planning documents

| # | Document | Purpose |
|---|----------|---------|
| 0 | [Overview & scope](docs/00-overview.md) | Vision, target users, goals, non-goals |
| 1 | [Requirements](docs/01-requirements.md) | Functional and non-functional requirements (with IDs) |
| 2 | [Architecture options](docs/02-architecture.md) | Integration surfaces, tech stack, transport, config |
| 3 | [Tool catalog](docs/03-tools-catalog.md) | Proposed MCP tools/resources/prompts, by phase |
| 4 | [Security & safety](docs/04-security-safety.md) | Guardrails for write operations and credentials |
| 5 | [Roadmap](docs/05-roadmap.md) | Phases and milestones |
| 6 | [Open questions](docs/06-open-questions.md) | Decisions we need to make together |
| 7 | [Getting started](docs/07-getting-started.md) | Build, configure, register with Claude, troubleshooting |

## How we'll use these docs

1. Review each doc, answer the open questions in `06-open-questions.md`.
2. Lock decisions into the ADR section in `02-architecture.md`.
3. Start implementation with Phase 1 (read-only MVP).
