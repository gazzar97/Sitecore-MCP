import { z } from "zod";

export const DATABASES = ["master", "web", "core"] as const;
export type Database = (typeof DATABASES)[number];

const sscAuthSchema = z.object({
  mode: z.literal("ssc"),
  domain: z.string().min(1).default("sitecore"),
  username: z.string().min(1),
  /** Name of the environment variable holding the password. Secrets never live in the config file. */
  passwordEnv: z.string().min(1),
});

const fileLogsSchema = z.object({
  source: z.literal("file"),
  /** Folder containing Sitecore log files (IIS: <webroot>/App_Data/logs, Docker: a mounted volume). */
  path: z.string().min(1),
  /** File name prefix of the main log. */
  filePrefix: z.string().min(1).default("log."),
});

const dockerLogsSchema = z.object({
  source: z.literal("docker"),
  /** Container name or ID, e.g. "myproject-cm-1". */
  container: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "Invalid container name"),
});

export const instanceSchema = z.object({
  cmUrl: z.string().url(),
  type: z.enum(["docker", "iis"]).default("iis"),
  auth: sscAuthSchema,
  allowInsecureTls: z.boolean().default(false),
  /** Extra host names allowed for this instance (supports "*.suffix"). */
  allowedHosts: z.array(z.string().min(1)).default([]),
  defaultDatabase: z.enum(DATABASES).default("master"),
  defaultLanguage: z.string().min(1).default("en"),
  timeoutMs: z.number().int().positive().default(30_000),
  /** Max concurrent HTTP requests to this instance. Template/tree walks run in parallel up to this limit. */
  maxConcurrency: z.number().int().min(1).max(16).default(6),
  logs: z.discriminatedUnion("source", [fileLogsSchema, dockerLogsSchema]).optional(),
  repoPath: z.string().optional(),
  /** Write access is OFF unless enabled here (see docs/04-security-safety.md). */
  permissions: z
    .object({
      /** Create and update items. */
      write: z.boolean().default(false),
      /** Delete items (always to the Recycle Bin). Requires write too. */
      delete: z.boolean().default(false),
      /** Reserved: publishing is not implemented yet. */
      publish: z.boolean().default(false),
    })
    .default({}),
  /** Writes are only allowed at or below these paths (master database only). */
  writeRoots: z.array(z.string().min(1)).default(["/sitecore/content"]),
  /** Refuse to delete an item whose subtree has more items than this. */
  maxDeleteItems: z.number().int().min(1).max(1000).default(50),
});

export const configSchema = z
  .object({
    defaultInstance: z.string().optional(),
    allowedHosts: z.array(z.string().min(1)).default([]),
    /** JSONL audit log of every write attempt. Default: ~/.sitecore-mcp/audit.log */
    auditLogPath: z.string().min(1).optional(),
    output: z
      .object({
        maxFieldLength: z.number().int().positive().default(500),
      })
      .default({}),
    instances: z.record(z.string().regex(/^[a-zA-Z0-9_-]+$/), instanceSchema).refine(
      (v) => Object.keys(v).length > 0,
      "At least one instance must be configured",
    ),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.defaultInstance && !(cfg.defaultInstance in cfg.instances)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultInstance"],
        message: `defaultInstance "${cfg.defaultInstance}" is not defined in instances`,
      });
    }
  });

export type InstanceConfig = z.infer<typeof instanceSchema>;
export type SitecoreMcpConfig = z.infer<typeof configSchema>;
