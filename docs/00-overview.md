# 00 — Overview & Scope

## Problem

Sitecore developers spend a lot of time switching between the Content Editor, Solr admin, log files, serialization CLI, and IDE to answer questions like:

- "What template does this item use, and what fields does it inherit?"
- "Why is this rendering not showing — what's in the presentation details?"
- "What changed between my serialized items and what's in the DB?"
- "What do the last errors in the Sitecore log say?"
- "Create 20 test items under this folder from this template."

An AI assistant could do this much faster if it had a safe, structured way to talk to the local Sitecore instance.

## Vision

A local-first MCP server that exposes a running Sitecore development instance as a set of **tools, resources, and prompts** an AI assistant can use — read-heavy by default, with opt-in, guarded write operations.

## Target users

- Sitecore backend / full-stack developers working on local instances (IIS or Docker).
- Front-end / headless (JSS / Next.js) developers who need content & layout data.
- QA / content people preparing test content locally (secondary).

## Target environments (to confirm — see open questions)

| Environment | Priority |
|---|---|
| Sitecore XM/XP 10.x on Docker (local dev containers) | P0 |
| Sitecore XM/XP 10.x on local IIS (SIF installed) | P0 |
| Sitecore 9.x on local IIS | P2 (maybe) |
| XM Cloud local Docker dev environment | P1 |
| Remote / shared DEV/QA/UAT/PROD environments | **Out of scope** for v1 |

## Goals

1. Read content tree, items, fields, templates, layout/presentation details.
2. Search content (via Sitecore query / content search / GraphQL).
3. Read Sitecore logs and basic diagnostics (health, indexes, publishing state).
4. Guarded write operations: create/update/delete items, publish, rebuild index — only on local instances and only when explicitly enabled.
5. Work with serialization (SCS / Unicorn) to compare repo vs. instance.
6. Support **multiple local instances** (e.g. two projects running side by side) via named profiles.
7. Zero/minimal changes required on the Sitecore side where possible.

## Non-goals (v1)

- Connecting to shared or production environments.
- Replacing the Content Editor / Experience Editor / Pages UI.
- xDB / analytics / personalization / marketing automation data.
- Commerce, EXM, Forms submission data.
- Installing or provisioning Sitecore instances.

## Success criteria

- A developer can install and point the MCP at a local instance in **< 5 minutes**.
- Common "explain this item / rendering / template" questions answered without opening Sitecore UI.
- No destructive action can happen without explicit opt-in config + per-call confirmation.
