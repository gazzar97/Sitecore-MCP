# Sitecore MCP (Local Instances)

An MCP (Model Context Protocol) server that lets AI assistants such as Claude Code read and edit **locally running Sitecore instances** used for development: browse content, inspect templates, search, read logs, and (optionally) create/update/delete items.

> Status: **read tools** and **guarded create/update/delete (off by default)** are implemented and verified against a local Sitecore 10.4 IIS instance.

**You need:** Node.js 18.16+ (20+ recommended), [Claude Code](https://claude.com/claude-code), and a local Sitecore 9.x/10.x instance (IIS or Docker) with a Sitecore admin login.

## Get started in 3 steps

### 1. Install

```bash
git clone https://github.com/gazzar97/Sitecore-MCP.git
cd Sitecore-MCP
npm install
npm run build
```

### 2. Point it at your Sitecore instance

Create `~/.sitecore-mcp/config.json` (on Windows: `C:\Users\<you>\.sitecore-mcp\config.json`):

```json
{
  "defaultInstance": "local",
  "instances": {
    "local": {
      "cmUrl": "https://mysite.dev.local",
      "auth": { "mode": "ssc", "username": "admin", "passwordEnv": "SITECORE_PASSWORD" },
      "allowInsecureTls": true,
      "logs": { "source": "file", "path": "C:/inetpub/wwwroot/mysite.dev.local/App_Data/logs" }
    }
  }
}
```

- `cmUrl`: your CM site's URL. It must be local (`localhost`, `*.localhost`, or a hosts-file name pointing to `127.0.0.1`).
- The password is **not** stored here. `passwordEnv` names an environment variable that holds it; you set that in step 3.
- `allowInsecureTls: true` accepts the self-signed certificate a local Sitecore install creates.
- `logs` is optional. For Docker use `{ "source": "docker", "container": "<cm container name>" }`.


### 3. Add it to Claude Code and start asking

From the `Sitecore-MCP` folder:

```bash
claude mcp add sitecore -s user --env SITECORE_PASSWORD=<your admin password> -- node "$(pwd)/dist/index.js"
```

Start a **new** Claude Code session, run `/mcp` to confirm `sitecore` is connected, then just ask in plain language:

- *"Ping my Sitecore instance."*
- *"Show the content tree under /sitecore/content, 2 levels deep."*
- *"What template does /sitecore/content/Home use, and what fields does it have?"*
- *"Find items under /sitecore/content/MySite whose Title contains 'contact'."*
- *"Show the last 10 errors from the Sitecore log and explain what's wrong."*

## Teach it your instance (recommended)

Run a one-time, read-only discovery so Claude knows your sites, templates, renderings and placeholders without slow live lookups:

```bash
SITECORE_PASSWORD=<your admin password> npm run discover -- local
```

Then start sessions with *"Load the Sitecore knowledge"*. Add your team's conventions to `~/.sitecore-mcp/knowledge/local/notes.md`, and Claude will follow them. Details: [knowledge base](docs/08-instance-knowledge-base.md).

## Allowing Claude to edit content (optional)

Out of the box it's **read-only**. To allow creating and updating items, add this to your instance in `config.json` and start a new Claude Code session:

```json
"permissions": { "write": true, "delete": false },
"writeRoots": ["/sitecore/content/MySite"]
```

Then ask, for example: *"Change the Title of /sitecore/content/MySite/Home to 'Welcome'. Dry run first."*

Safety rules that always apply:
- writes go to the `master` database only, and only under `writeRoots`
- Sitecore system paths are never writable
- unknown field names are rejected
- deletes (if you enable `"delete": true`) always go to the Recycle Bin
- every write is logged to `~/.sitecore-mcp/audit.log`
- nothing is published: changes stay in `master` until you publish them in Sitecore

Claude Code also asks you to approve each write.

## Tools

| Tool | What it does |
|---|---|
| `sitecore_instances_list` / `sitecore_ping` | Show configured instances; check login and Sitecore version |
| `sitecore_item_get` / `sitecore_item_children` | Read an item's fields; list children or a tree |
| `sitecore_template_get` | Template sections, fields and inheritance |
| `sitecore_search` | Search the live tree under a root, or full-text through the content index |
| `sitecore_logs_tail` | Recent log entries filtered by level or text |
| `sitecore_knowledge` | Instant answers from the local knowledge base (after `npm run discover`) |
| `sitecore_item_create` / `sitecore_item_update` / `sitecore_item_delete` | Only when enabled in config (see above) |

## Something not working?

| Problem | Fix |
|---|---|
| `Refusing to connect to "<host>"` | The host doesn't look local. If it is, add it to `"allowedHosts": ["<host>"]` in the config. |
| `... is not set` (password) | The env var named in `passwordEnv` wasn't passed. Re-run the `claude mcp add` command with `--env`. |
| Login or item calls return HTTP 403 | See the SSC notes in the [troubleshooting table](docs/07-getting-started.md#troubleshooting) (common on Docker). |
| `sitecore` not listed in `/mcp` | Start a new Claude Code session; tools load at startup. |

More detail is in [Getting started](docs/07-getting-started.md): Docker, multiple instances, Claude Desktop / VS Code, and smoke tests.

## Documentation

| # | Document | Purpose |
|---|----------|---------|
| 0 | [Overview & scope](docs/00-overview.md) | Vision, target users, goals, non-goals |
| 1 | [Requirements](docs/01-requirements.md) | Functional and non-functional requirements (with IDs) |
| 2 | [Architecture](docs/02-architecture.md) | Integration surfaces, tech stack, decisions (ADRs) |
| 3 | [Tool catalog](docs/03-tools-catalog.md) | MCP tools by phase |
| 4 | [Security & safety](docs/04-security-safety.md) | Guardrails for write operations and credentials |
| 5 | [Roadmap](docs/05-roadmap.md) | Phases, status and what's next |
| 6 | [Open questions](docs/06-open-questions.md) | Decisions still open |
| 7 | [Getting started](docs/07-getting-started.md) | Full setup, configuration reference, troubleshooting |
| 8 | [Instance knowledge base](docs/08-instance-knowledge-base.md) | First-run discovery of templates, renderings, placeholders and sites, reused every session (K1–K4 done: incl. content map, page types and rendering usage; forms and workflows planned) |

## Development

```bash
npm test            # unit + in-memory MCP integration tests (no Sitecore needed)
npm run typecheck
```
