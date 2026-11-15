# 02 — Architecture Options

```
 ┌──────────────┐  stdio (JSON-RPC)  ┌─────────────────────────┐
 │ AI client     │ ◄───────────────► │ sitecore-mcp server      │
 │ (Claude Code, │                    │  ├─ tool layer           │
 │  Desktop, ...)│                    │  ├─ instance profiles    │
 └──────────────┘                    │  ├─ safety/guard layer   │
                                     │  └─ adapters ────────────┼──► Sitecore APIs (HTTP)
                                     │                          ├──► Log files / docker logs
                                     │                          └──► Repo (serialization YAML)
                                     └─────────────────────────┘
```

## 1. Integration surfaces with Sitecore (adapter options)

We should design an **adapter interface** so tools don't care which API is used underneath.

| Option | What it gives us | Pros | Cons | Requires on Sitecore side |
|---|---|---|---|---|
| **A. Authoring & Management GraphQL API** (`/sitecore/api/authoring/graphql/v1`) | Items CRUD, templates, search, publishing, sites | Official, modern, same as XM Cloud; good for writes | 10.3+ only; needs Identity Server token (client credentials / user); must be enabled | Enable via config; register client in Identity Server |
| **B. Sitecore Services Client – ItemService** (`/sitecore/api/ssc/item`) | Item read/CRUD, children, search | Available since 7.5 / all 9.x–10.x; cookie auth with username/password | Limited (no templates detail, no layout parsing, no publish) | Usually on by default; may need `allowAnonymousAccess`/SSL tweaks |
| **C. Sitecore PowerShell Extensions (SPE) Remoting** (`/-/script/...`) | Almost anything (run scripts): layout, templates, publish, index, cache | Extremely powerful, covers gaps of A/B | SPE must be installed & remoting enabled; arbitrary code exec = high risk | SPE module + remoting config + user |
| **D. Edge / Layout Service GraphQL (preview)** (`/sitecore/api/graph/edge`, `/sitecore/api/layout/render/jss`) | Headless layout JSON, delivery-shaped content | Exactly what JSS/Next.js sees | Read-only, delivery perspective only | API key item |
| **E. Custom companion package** (our own `.dll` + config exposing REST endpoints) | Whatever we need, efficient | Full control, best responses | Must be deployed to every instance; versioning per Sitecore version | Deploy DLL |
| **F. Direct SQL (read-only)** | Raw items/fields | No Sitecore config needed | Bypasses caching/security, fragile, blobs/layout deltas hard | DB access |
| **G. File system** | Logs, serialization YAML, configs (`App_Config`) | Simple, no auth | Path differences IIS vs Docker | Path / volume access |

**Proposed direction (to discuss):**
- **Primary:** A (Authoring GraphQL) for 10.3+, with **B (ItemService)** as fallback for older 10.x/9.x.
- **Power mode (optional):** C (SPE remoting) for layout, publishing, indexes, caches — disabled by default.
- **Headless:** D for layout JSON.
- **Always:** G for logs and serialization.
- **Avoid** E and F for v1.

## 2. Tech stack options

| Option | Pros | Cons |
|---|---|---|
| **TypeScript / Node** (`@modelcontextprotocol/sdk`) | Most mature MCP SDK, `npx` install, good GraphQL tooling, matches JSS/Next.js devs | Not the native language of Sitecore backend devs |
| **C# / .NET 8+** (`ModelContextProtocol` NuGet SDK) | Team's core language, `dotnet tool` install, could reuse Sitecore DTO knowledge, SCS CLI is .NET | SDK is newer; still cannot reference Sitecore.Kernel (net48) directly |

Recommendation: _TBD together_ — see open question Q2.

## 3. Transport

- **stdio** for v1 (one process per client, simplest, local-only by nature).
- Streamable HTTP later only if we need a shared server (out of scope v1).

## 4. Configuration (draft)

`sitecore-mcp.config.json` (location: user profile, overridable via `SITECORE_MCP_CONFIG` env var). Secrets via env vars.

```json
{
  "defaultInstance": "projectA",
  "instances": {
    "projectA": {
      "cmUrl": "https://projecta-cm.localhost",
      "type": "docker",                      // docker | iis
      "version": "10.4",
      "auth": {
        "mode": "identityServer",            // identityServer | ssc-cookie | spe
        "identityUrl": "https://projecta-id.localhost",
        "clientId": "SitecoreCLIServer",
        "clientSecretEnv": "PROJECTA_SC_SECRET"
      },
      "spe": { "enabled": false, "username": "admin", "sharedSecretEnv": "PROJECTA_SPE_SECRET" },
      "edge": { "apiKeyEnv": "PROJECTA_SC_APIKEY" },
      "logs": { "source": "docker", "container": "projecta-cm-1" },
      "repoPath": "C:/repos/projectA",       // for serialization
      "allowInsecureTls": true,
      "permissions": { "write": false, "publish": false, "delete": false }
    }
  }
}
```

## 5. Internal module layout (draft)

```
src/
  server.(ts|cs)          # MCP bootstrap, tool registration
  config/                 # profile loading, validation, secret resolution
  adapters/
    authoring-graphql/
    ssc-itemservice/
    spe-remoting/
    edge/
    logs/                 # file + docker
    serialization/        # SCS/Unicorn YAML reader
  domain/                 # Item, Field, Template, Rendering DTOs (adapter-agnostic)
  tools/                  # one file per tool group
  safety/                 # allowlist, permission checks, dry-run, audit log
  formatting/             # token-efficient output shaping
tests/
```

## 6. Decisions log (ADR)

Decisions marked **Provisional** were taken to start Phase 1 while the open questions (06) are unanswered. Revisit them when we discuss.

| # | Decision | Status | Rationale |
|---|---|---|---|
| ADR-01 | **TypeScript / Node**, `@modelcontextprotocol/sdk` 1.x, stdio transport. Node ≥ 18.16 (built-in `node:http(s)` instead of undici so it runs on the current dev machine's Node 18). | Provisional | Most mature MCP SDK; no Sitecore assemblies needed since we talk HTTP. |
| ADR-02 | **Phase 1 adapter = SSC ItemService** (`/sitecore/api/ssc/item`, cookie login). Authoring GraphQL becomes a second `ContentAdapter` in Phase 1b. | Provisional (changed from the original proposal) | SSC exists on 9.x–10.x with no extra setup and its contract is well known. The Authoring GraphQL schema and Identity Server client setup need checking against a real instance before we build on them. The `ContentAdapter` interface (`src/domain/types.ts`) keeps tools independent of the API used. |
| ADR-03 | No SPE in v1 | Provisional | Arbitrary code execution risk; revisit in Phase 4. |
| ADR-04 | Target Sitecore 10.x; 9.x expected to work via SSC (untested) | Provisional | |
| ADR-05 | Templates are read by walking template items (template → sections → fields, `__Base template`) through the adapter | Accepted | Works with any adapter that can read items. |
| ADR-07 | SSC requests always list required item properties in `fields=` and never send `includeMetadata`; one `Semaphore` per instance caps concurrent requests | Accepted (verified on 10.4) | Found by testing against a real instance. Parallel walks hide per-request latency. |
| ADR-06 | Search has two modes: `tree` (live DB walk, bounded) and `index` (SSC term search) | Accepted | SSC search can't scope to a root or template; the tree walk is accurate even when indexes are stale. |
