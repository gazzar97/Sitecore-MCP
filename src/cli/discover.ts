#!/usr/bin/env node
/**
 * First-run discovery (read-only against Sitecore):
 *   npm run discover -- [instance] [--sections templates,renderings]
 * Writes the instance knowledge base to ~/.sitecore-mcp/knowledge/<instance>/ (or config.knowledgePath).
 */
import { loadConfig } from "../config/load.js";
import { toUserMessage } from "../errors.js";
import { InstanceRegistry } from "../instances.js";
import { discover } from "../knowledge/discover.js";
import { SECTIONS, type DiscoverySection } from "../knowledge/types.js";

function parseArgs(argv: string[]): { instance?: string; sections?: DiscoverySection[] } {
  let instance: string | undefined;
  let sections: DiscoverySection[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--sections") {
      const list = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = list.filter((s) => !(SECTIONS as readonly string[]).includes(s));
      if (bad.length) throw new Error(`Unknown section(s): ${bad.join(", ")}. Valid: ${SECTIONS.join(", ")}`);
      sections = list as DiscoverySection[];
    } else if (!a.startsWith("--")) {
      instance = a;
    }
  }
  return { instance, sections };
}

async function main(): Promise<number> {
  const { instance, sections } = parseArgs(process.argv.slice(2));
  const registry = new InstanceRegistry(loadConfig());
  const ctx = await registry.get(instance);
  const store = registry.knowledgeStore(ctx.name);
  console.log(`Discovering "${ctx.name}" (${ctx.config.cmUrl}), read-only. Sections: ${(sections ?? SECTIONS).join(", ")}`);
  const result = await discover(ctx, store, {
    sections,
    onProgress: (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`),
  });
  console.log(`\nKnowledge base: ${result.dir}`);
  console.log(`Overview:       ${result.dir}/overview.md`);
  console.log(`Your notes:     ${result.dir}/notes.md`);
  return Object.values(result.sections).some((s) => s?.status === "error") ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(toUserMessage(err));
    process.exit(1);
  },
);
