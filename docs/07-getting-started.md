# 07 — Getting Started (Phase 1, read-only)

## Requirements

- Node.js **18.16+** (Node 20+ recommended)
- A local Sitecore 9.x/10.x instance (IIS or Docker) with **Sitecore Services Client (SSC)** enabled (it is by default)

## 1. Build

```bash
npm install
npm run build
```

## 2. Configure

Copy `sitecore-mcp.config.example.json` to one of these locations (checked in order):

1. Path in env var `SITECORE_MCP_CONFIG`
2. `./sitecore-mcp.config.json` (current working directory; git-ignored)
3. `~/.sitecore-mcp/config.json`

Passwords are **never** stored in the config. Each instance names an env var (`passwordEnv`) that holds the password.

| Setting | Notes |
|---|---|
| `cmUrl` | CM base URL. Must be local: `localhost`, `*.localhost`, a loopback/private IP, a name that resolves only to local IPs (hosts file), or listed in `allowedHosts`. |
| `auth` | `mode: "ssc"`, `domain` (default `sitecore`), `username`, `passwordEnv`. |
| `allowInsecureTls` | `true` to accept self-signed dev certificates. |
| `logs` | `{ "source": "file", "path": "<webroot>/App_Data/logs" }` or `{ "source": "docker", "container": "<cm container>" }`. |

## 3. Check the connection

```bash
PROJECTA_SC_PASSWORD=b npm run ping
```

## 4. Register with your AI client

**Claude Code**

```bash
claude mcp add sitecore --env PROJECTA_SC_PASSWORD=b --env SITECORE_MCP_CONFIG=C:/Users/me/.sitecore-mcp/config.json -- node C:/Users/MahmoudElgazaar/source/repos/sitecore-mcp/dist/index.js
```

**Claude Desktop / VS Code** (`mcpServers` / `servers` block):

```json
{
  "sitecore": {
    "command": "node",
    "args": ["C:/Users/MahmoudElgazaar/source/repos/sitecore-mcp/dist/index.js"],
    "env": { "PROJECTA_SC_PASSWORD": "b", "SITECORE_MCP_CONFIG": "C:/Users/me/.sitecore-mcp/config.json" }
  }
}
```

## Tools available in Phase 1

| Tool | Purpose |
|---|---|
| `sitecore_instances_list` | Configured instances (or the config error, if any) |
| `sitecore_ping` | Host check + login + Sitecore version |
| `sitecore_item_get` | Item by ID/path with fields (truncated unless `verbose`) |
| `sitecore_item_children` | Children (paged) or a nested tree up to depth 3 |
| `sitecore_template_get` | Template sections/fields, base templates, inheritance chain |
| `sitecore_search` | `tree` mode (live DB walk under a root) or `index` mode (content search term) |
| `sitecore_logs_tail` | Recent log entries filtered by level/text |

## Enabling writes (create / update / delete)

Writes are **off** by default. Turn them on per instance in `~/.sitecore-mcp/config.json`, then restart Claude Code (the server reads the config at startup):

```json
"nbe": {
  "...": "...",
  "permissions": { "write": true, "delete": false },
  "writeRoots": ["/sitecore/content/NBE"],
  "maxDeleteItems": 50
}
```

| Setting | Effect |
|---|---|
| `permissions.write` | Adds `sitecore_item_create` and `sitecore_item_update` |
| `permissions.delete` | Also adds `sitecore_item_delete` (needs `write` too). Deleted items always go to the **Recycle Bin**. |
| `writeRoots` | Writes only at or below these paths (default `["/sitecore/content"]`). A write root itself can never be deleted. |
| `maxDeleteItems` | Refuse deletes whose subtree has more items than this (default 50) |
| `auditLogPath` (top level) | Where every write attempt is logged (default `~/.sitecore-mcp/audit.log`) |

These rules always apply, whatever the config says:
- writes go to the `master` database only
- `/sitecore/system`, `/sitecore/templates/System` and `/sitecore/layout/System` are never writable
- unknown field names are rejected, because Sitecore would silently drop them
- duplicate sibling names are refused unless you ask for them
- items with children need `includeChildren=true` to be deleted
- nothing is **published**: changes stay in `master` until you publish

Example requests: *"Create a Sample Item called Test under /sitecore/content/NBE/_mcp-test with Title 'Hello'. Do a dry run first."*, *"Change the Title of …/Test to 'Hi'"*, *"Delete …/Test"*.

To re-check write behaviour against a real instance (scratch folder only):

```bash
MSYS_NO_PATHCONV=1 NBE_SC_PASSWORD=b SITECORE_MCP_CONFIG=<config with writeRoots=[scratch]> node scripts/smoke-writes.mjs /sitecore/content/NBE/_mcp-test "/sitecore/templates/Sample/Sample Item" Title
```

(`MSYS_NO_PATHCONV=1` stops Git Bash rewriting `/sitecore/...` arguments into Windows paths.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Refusing to connect to "<host>"` | Host isn't local. If it is (e.g. a custom hosts-file name not resolving), add it to `allowedHosts`. |
| `SSC login failed ... (HTTP 403)` over `http://` | SSC only allows login over HTTPS unless `Sitecore.Services.AllowToLoginWithHttp` is `true`. Use the HTTPS binding. |
| Item calls return HTTP 403 (common in Docker) | SSC's default `ServicesLocalOnlyPolicy` rejects non-local requests. In a **local-only** config patch, set `Sitecore.Services.SecurityPolicy` to `Sitecore.Services.Infrastructure.Web.Http.Security.ServicesOnPolicy, Sitecore.Services.Infrastructure`. |
| TLS certificate errors | Trust the dev cert (mkcert / Docker init script) or set `allowInsecureTls: true`. |
| `docker logs` shows no Sitecore entries | Sitecore containers write log files inside the container. Mount `C:\inetpub\wwwroot\App_Data\logs` to a host folder and use `"source": "file"`. |
| Version shows "unknown" | `/sitecore/shell/sitecore.version.xml` isn't readable. Harmless. |
| Every call takes ~4 s; template/tree tools take 20–45 s | The CM itself is slow per request (compare `curl -w '%{time_starttransfer}'` on any `/sitecore/api/ssc` URL). On `nbesc.dev.local` this lined up with a custom OpenTelemetry module repeatedly failing to reach `127.0.0.1:4318` (connection refused on Windows costs ~2 s per attempt). Start an OTLP collector or disable the exporter locally. `maxConcurrency` (default 6) runs template/tree requests in parallel to hide some of the delay. |

## Real-instance smoke test

Runs every tool through the real stdio server against your configured instance:

```bash
NBE_SC_PASSWORD=b npm run smoke -- [instance] [contentRoot]
```

## Development

```bash
npm test          # unit + in-memory MCP integration tests (fake SSC server)
npm run typecheck
```
