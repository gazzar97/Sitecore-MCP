import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../src/config/load.js";
import { ConfigError } from "../src/errors.js";

const minimal = {
  instances: {
    local: { cmUrl: "https://cm.localhost", auth: { mode: "ssc", username: "admin", passwordEnv: "SC_PWD" } },
  },
};

describe("parseConfig", () => {
  it("applies defaults", () => {
    const cfg = parseConfig(minimal);
    const i = cfg.instances.local!;
    expect(i.auth.domain).toBe("sitecore");
    expect(i.defaultDatabase).toBe("master");
    expect(i.defaultLanguage).toBe("en");
    expect(i.allowInsecureTls).toBe(false);
    expect(i.permissions).toEqual({ write: false, publish: false, delete: false });
    expect(cfg.output.maxFieldLength).toBe(500);
  });

  it("rejects unknown defaultInstance", () => {
    expect(() => parseConfig({ ...minimal, defaultInstance: "nope" })).toThrow(/defaultInstance/);
  });

  it("rejects empty instances and bad container names", () => {
    expect(() => parseConfig({ instances: {} })).toThrow(ConfigError);
    expect(() =>
      parseConfig({
        instances: { a: { ...minimal.instances.local, logs: { source: "docker", container: "cm; rm -rf /" } } },
      }),
    ).toThrow(/container/);
  });
});

describe("loadConfig", () => {
  it("loads from SITECORE_MCP_CONFIG", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-"));
    const file = join(dir, "c.json");
    writeFileSync(file, JSON.stringify(minimal));
    const { config, path } = loadConfig({ SITECORE_MCP_CONFIG: file }, dir);
    expect(path).toBe(file);
    expect(Object.keys(config.instances)).toEqual(["local"]);
  });

  it("errors clearly when the env var points nowhere", () => {
    expect(() => loadConfig({ SITECORE_MCP_CONFIG: "Z:/missing.json" }, tmpdir())).toThrow(/does not exist/);
  });

  it("reports invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-"));
    writeFileSync(join(dir, "sitecore-mcp.config.json"), "{ nope");
    expect(() => loadConfig({}, dir)).toThrow(/Could not parse/);
  });
});
