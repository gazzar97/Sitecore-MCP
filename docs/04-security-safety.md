# 04 — Security & Safety

The server gives an AI agent the ability to change a Sitecore instance. Even locally, a bad call can wreck hours of content work. Safety is a first-class requirement.

## Principles

1. **Read-only by default.** Write, publish, delete, and SPE are off unless enabled per instance in config.
2. **Local only.** Host must match the allowlist (`localhost`, `127.0.0.1`, `*.localhost`, explicitly configured local hostnames, private IP ranges). Anything else → refuse.
3. **Least privilege.** Recommend a dedicated Sitecore user / Identity Server client for the MCP, not `sitecore\admin`, where possible.
4. **No secrets in output or logs.** Tokens, passwords, API keys resolved from env vars and redacted everywhere.
5. **Reversible by default.** Delete → Recycle Bin only. No permanent deletes, no `core` DB writes.

> **Status:** implemented in `src/safety/writeGuard.ts`, `src/domain/writes.ts` and `src/audit/auditLog.ts`. Not yet implemented: `publish`, the bulk-item limit for create (create is one item per call), and a separate `confirm` parameter (we rely on the client's approval prompt plus `dryRun`).

## Guard layers for write tools

| Layer | Behaviour |
|---|---|
| Config permission flags | `permissions.write / publish / delete / spe` per instance |
| Database guard | Writes only to `master`; `core` and `web` writes blocked |
| Path guard | Optional `writeRoots` allowlist (e.g. `/sitecore/content/MySite`); system paths (`/sitecore/system`, `/sitecore/templates/System`) blocked |
| Dry run | `dryRun: true` returns planned changes; maybe the default for bulk ops |
| Bulk limit | Max items per call (e.g. 50) unless overridden in config |
| Client confirmation | Rely on MCP client approval prompts; tools annotated with `destructiveHint` / `readOnlyHint` |
| Audit log | Append-only JSONL: timestamp, instance, tool, args (redacted), result |

## SPE remoting risk

SPE remoting = arbitrary code execution on the CM. If supported:
- Off by default; separate `permissions.spe` flag.
- **No free-form script tool** in v1 — only fixed, parameterized scripts shipped with the MCP.
- Script parameters passed as typed params, never string-concatenated into script text.

## Prompt-injection awareness

Item field values and log lines are untrusted data. Tool descriptions should state that content returned is data; write tools should never be triggered by text found inside content.

## Open points

- Should write ops require an extra `confirm: true` param in addition to client approval?
- Should we support a "sandbox root" mode where all writes are forced under a scratch folder?
