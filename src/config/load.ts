import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { configSchema, type SitecoreMcpConfig } from "./schema.js";
import { ConfigError } from "../errors.js";

export const CONFIG_ENV_VAR = "SITECORE_MCP_CONFIG";

/** Candidate config locations, in priority order. */
export function configCandidates(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const list: string[] = [];
  if (env[CONFIG_ENV_VAR]) list.push(resolve(env[CONFIG_ENV_VAR]!));
  list.push(join(cwd, "sitecore-mcp.config.json"));
  list.push(join(homedir(), ".sitecore-mcp", "config.json"));
  return list;
}

export function parseConfig(raw: unknown, source = "config"): SitecoreMcpConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid ${source}:\n${issues}`);
  }
  return result.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): {
  config: SitecoreMcpConfig;
  path: string;
} {
  const candidates = configCandidates(env, cwd);
  if (env[CONFIG_ENV_VAR] && !existsSync(candidates[0]!)) {
    throw new ConfigError(`${CONFIG_ENV_VAR} points to "${candidates[0]}", which does not exist.`);
  }
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new ConfigError(
      `No config file found. Create one of:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n` +
        `See sitecore-mcp.config.example.json.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`Could not parse ${path}: ${(e as Error).message}`);
  }
  return { config: parseConfig(raw, path), path };
}
