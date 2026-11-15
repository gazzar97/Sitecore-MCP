# 06 — Open Questions (let's decide together)

Fill in the **Answer** column as we discuss.

| # | Question | Options / notes | Answer |
|---|---|---|---|
| Q1 | Which Sitecore versions & topologies do your local instances run? | 10.2 / 10.3 / 10.4 / XM Cloud; XM vs XP; Docker vs IIS; headless (JSS/Next.js) or MVC? | |
| Q2 | Language for the MCP server? | **TypeScript** (most mature SDK, npx) vs **C# .NET 8** (team language, dotnet tool) | |
| Q3 | Primary Sitecore API? | Authoring GraphQL (10.3+) / SSC ItemService / SPE remoting / mix | |
| Q4 | Is SPE installed on your local instances, and are you OK enabling remoting locally? | Unlocks layout, publish, index, cache ops easily | |
| Q5 | Are you willing to deploy a small companion package to local instances? | Gives best data but adds install step (currently a non-goal) | |
| Q6 | Write operations in scope for v1 at all? | Read-only v1 vs. guarded writes in v1 | |
| Q7 | Which serialization tool do your projects use? | SCS (Sitecore CLI), Unicorn, TDS, none | |
| Q8 | Which AI clients must be supported? | Claude Code, Claude Desktop, VS Code Copilot, Cursor | |
| Q9 | Who are the users — just you, your team, or open-source for the community? | Affects packaging, license, docs depth | |
| Q10 | Auth preference for local instances? | Identity Server client credentials (needs client registration) vs username/password (SSC cookie) | |
| Q11 | Multi-instance needed from day one? | Many devs run 2+ projects at once | |
| Q12 | Any top 3 "jobs to be done" you want first? | e.g. explain item, debug rendering, read logs, create test content | |
| Q13 | Repo/hosting & work tracking? | Azure DevOps vs GitHub; backlog items from these requirements? | |
