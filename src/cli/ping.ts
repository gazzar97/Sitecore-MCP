#!/usr/bin/env node
/** Quick setup check outside an MCP client: `npm run ping -- [instance]` */
import { loadConfig } from "../config/load.js";
import { toUserMessage } from "../errors.js";
import { InstanceRegistry } from "../instances.js";

async function main(): Promise<number> {
  const loaded = loadConfig();
  console.log(`config: ${loaded.path}`);
  const registry = new InstanceRegistry(loaded);
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(loaded.config.instances);
  let failures = 0;
  for (const name of names) {
    try {
      const ctx = await registry.get(name);
      const info = await ctx.adapter.getServerInfo();
      console.log(`OK    ${name}  ${ctx.config.cmUrl}  Sitecore ${info.sitecoreVersion ?? "(version unknown)"}`);
    } catch (err) {
      failures++;
      console.log(`FAIL  ${name}  ${toUserMessage(err)}`);
    }
  }
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(toUserMessage(err));
    process.exit(1);
  },
);
