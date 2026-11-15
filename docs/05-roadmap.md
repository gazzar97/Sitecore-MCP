# 05 — Roadmap (draft)

## Status (2026-11-15)

- **Phase 1 implemented** (read-only MVP, SSC adapter): all Phase 1 tools, config/profiles, local-host allowlist, log tail (file + docker). Unit tests and in-memory MCP integration tests pass against a fake SSC server.
- **Verified against a real local instance** (Sitecore 10.4 on IIS): all 7 read tools work through the stdio server (`npm run smoke`). The test found two SSC behaviours the fake server didn't model, now fixed and covered by tests:
  1. `fields=` also filters item properties (`ItemID`, `ItemName`, …), so they must be requested explicitly.
  2. `includeMetadata=true` returns per-field definitions, not item properties, so it is never sent.
- Performance: on a slow instance (seconds per request, server-side), template and tree walks now run in parallel (`maxConcurrency`), roughly halving their time and keeping large templates under the client timeout.
- **Phase 3 (guarded writes) implemented and verified on a real local instance:**
  - `sitecore_item_create`, `sitecore_item_update` and `sitecore_item_delete`, with dry-run, field-name validation, duplicate-name and subtree checks, re-reading after each write, and a JSONL audit log
  - SQL confirmed that deletes land in the `recyclebin` archive
  - write tools only appear when a configured instance enables them
  - **Not done in Phase 3:** publishing (SSC has no publish endpoint; it needs Authoring GraphQL or SPE), language-version creation, move/rename/copy, presentation edits
- Open: should the host guard allow private-network IPs by default? A hosts-file entry pointing at a shared DEV server on the office network (e.g. `devcm.example.com` → `192.168.x.x`) currently passes.
- **Instance Knowledge Base K1–K3 done** ([08-instance-knowledge-base.md](08-instance-knowledge-base.md)):
  - `npm run discover` catalogued a real 10.4 instance in ~15 min: 378 templates, 107 renderings, 24 placeholders, 18 layouts
  - `sitecore_knowledge` answers template and rendering questions in ~10 ms, compared with 25–45 s live
  - Seen on that run: the template walk dominates (~10 min); the placeholder list includes Sitecore sample and EXM placeholders
- Next: K4 (content map, layout parsing), K5 (forms, workflows), K6–K8; then Phase 1b (Authoring GraphQL adapter for 10.3+) and Phase 2.

| Phase | Theme | Scope | Exit criteria |
|---|---|---|---|
| **0** | Decisions & spike | Answer open questions; spike auth against a Docker 10.x and an IIS 10.x instance | ADR-01..04 decided; can authenticate & fetch one item from both |
| **1** | Read-only MVP | Config/profiles, allowlist, `instances_list`, `ping`, `item_get`, `item_children`, `template_get`, `search`, `logs_tail`; Claude Code setup docs | Usable daily by the team for read questions |
| **2** | Deep read | Layout parsing, headless layout JSON, versions, template usages, query, indexes list, serialization modules/owner, error summary, showconfig | "Debug this rendering" works end to end |
| **3** | Guarded writes | Create/update items, publish, dry-run, audit log, serialization diff | Writes safely tested on Docker instance |
| **4** | Power features | SPE-backed ops (index rebuild, cache clear, jobs), move/copy/delete, model generation, SCS CLI runs, prompts | Optional modules behind flags |

## Testing strategy (draft)

- Unit tests for adapters with recorded HTTP fixtures.
- Integration test suite against a local Docker XM instance (env-gated, not in default CI).
- Contract tests: same tool output shape regardless of adapter (GraphQL vs SSC).
