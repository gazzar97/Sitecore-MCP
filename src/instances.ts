import { AuditLog } from "./audit/auditLog.js";
import { SscItemServiceAdapter } from "./adapters/ssc/sscAdapter.js";
import { SscClient } from "./adapters/ssc/sscClient.js";
import { DockerLogSource } from "./adapters/logs/dockerSource.js";
import { FileLogSource } from "./adapters/logs/fileSource.js";
import type { LogSource } from "./adapters/logs/types.js";
import type { InstanceConfig, SitecoreMcpConfig } from "./config/schema.js";
import type { ContentAdapter } from "./domain/types.js";
import { ConfigError } from "./errors.js";
import { createNodeTransport, type HttpTransport } from "./http/transport.js";
import { assertLocalUrl, type LookupAll } from "./safety/hostGuard.js";

export interface InstanceContext {
  name: string;
  config: InstanceConfig;
  adapter: ContentAdapter;
  logs: LogSource | undefined;
  maxFieldLength: number;
}

export interface RegistryDeps {
  env?: NodeJS.ProcessEnv;
  transportFactory?: (cfg: InstanceConfig) => HttpTransport;
  lookup?: LookupAll;
  audit?: AuditLog;
}

/** Holds configured instances and lazily builds their adapters. */
export class InstanceRegistry {
  private readonly cache = new Map<string, InstanceContext>();
  private readonly verifiedHosts = new Set<string>();
  readonly audit: AuditLog;

  constructor(
    private readonly state: { config: SitecoreMcpConfig; path: string } | { error: Error },
    private readonly deps: RegistryDeps = {},
  ) {
    this.audit = deps.audit ?? new AuditLog("config" in state ? state.config.auditLogPath : undefined);
  }

  /** True if any configured instance allows the given write permission. */
  anyInstanceAllows(permission: "write" | "delete"): boolean {
    if ("error" in this.state) return false;
    return Object.values(this.state.config.instances).some(
      (i) => i.permissions.write && (permission === "write" || i.permissions.delete),
    );
  }

  get config(): SitecoreMcpConfig {
    if ("error" in this.state) throw this.state.error;
    return this.state.config;
  }

  get configPath(): string | undefined {
    return "path" in this.state ? this.state.path : undefined;
  }

  get configError(): Error | undefined {
    return "error" in this.state ? this.state.error : undefined;
  }

  defaultName(): string {
    const cfg = this.config;
    return cfg.defaultInstance ?? Object.keys(cfg.instances)[0]!;
  }

  resolveName(name?: string): string {
    const cfg = this.config;
    const resolved = name ?? this.defaultName();
    if (!(resolved in cfg.instances)) {
      throw new ConfigError(
        `Unknown instance "${resolved}".`,
        `Configured instances: ${Object.keys(cfg.instances).join(", ")}`,
      );
    }
    return resolved;
  }

  /** Returns the instance context after verifying the host is local (FR-CON-06). */
  async get(name?: string): Promise<InstanceContext> {
    const resolved = this.resolveName(name);
    const cfg = this.config;
    const inst = cfg.instances[resolved]!;

    if (!this.verifiedHosts.has(resolved)) {
      await assertLocalUrl(inst.cmUrl, [...cfg.allowedHosts, ...inst.allowedHosts], this.deps.lookup);
      this.verifiedHosts.add(resolved);
    }

    let ctx = this.cache.get(resolved);
    if (!ctx) {
      ctx = this.build(resolved, inst, cfg.output.maxFieldLength);
      this.cache.set(resolved, ctx);
    }
    return ctx;
  }

  /** Log access needs no Sitecore HTTP call, so it skips the host check and login. */
  getLogSource(name?: string): LogSource {
    const resolved = this.resolveName(name);
    const source = buildLogSource(this.config.instances[resolved]!);
    if (!source) {
      throw new ConfigError(
        `No "logs" configured for instance "${resolved}".`,
        'Add "logs": {"source":"file","path":"<webroot>/App_Data/logs"} or {"source":"docker","container":"<cm container>"}.',
      );
    }
    return source;
  }

  private build(name: string, inst: InstanceConfig, maxFieldLength: number): InstanceContext {
    const env = this.deps.env ?? process.env;
    const transport = (this.deps.transportFactory ?? ((c) => createNodeTransport({ allowInsecureTls: c.allowInsecureTls })))(
      inst,
    );
    const client = new SscClient({
      baseUrl: inst.cmUrl,
      domain: inst.auth.domain,
      username: inst.auth.username,
      password: () => {
        const v = env[inst.auth.passwordEnv];
        if (!v) {
          throw new ConfigError(
            `Environment variable ${inst.auth.passwordEnv} (password for instance "${name}") is not set.`,
            "Set it in the MCP client's server env configuration.",
          );
        }
        return v;
      },
      transport,
      timeoutMs: inst.timeoutMs,
      maxConcurrency: inst.maxConcurrency,
    });
    return {
      name,
      config: inst,
      adapter: new SscItemServiceAdapter(client),
      logs: buildLogSource(inst),
      maxFieldLength,
    };
  }
}

function buildLogSource(inst: InstanceConfig): LogSource | undefined {
  if (!inst.logs) return undefined;
  return inst.logs.source === "file"
    ? new FileLogSource(inst.logs.path, inst.logs.filePrefix)
    : new DockerLogSource(inst.logs.container);
}
