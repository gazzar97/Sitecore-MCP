import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SitecoreMcpError } from "../../errors.js";
import { matchesLogFilter, parseSitecoreLog } from "./parser.js";
import type { LogSource, LogTailRequest, LogTailResult } from "./types.js";

const execFileAsync = promisify(execFile);

export type DockerLogsRunner = (container: string, tailLines: number) => Promise<string>;

const defaultRunner: DockerLogsRunner = async (container, tailLines) => {
  try {
    // execFile (no shell); container name is validated by the config schema.
    const { stdout, stderr } = await execFileAsync("docker", ["logs", "--tail", String(tailLines), container], {
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });
    return `${stdout}\n${stderr}`;
  } catch (e) {
    throw new SitecoreMcpError(
      `"docker logs ${container}" failed: ${(e as Error).message.split("\n")[0]}`,
      "Is Docker running and is the container name correct? (docker ps)",
    );
  }
};

/** Reads container output via `docker logs`. */
export class DockerLogSource implements LogSource {
  constructor(
    private readonly container: string,
    private readonly run: DockerLogsRunner = defaultRunner,
  ) {}

  describe(): string {
    return `docker:${this.container}`;
  }

  async tail(req: LogTailRequest): Promise<LogTailResult> {
    const text = await this.run(this.container, Math.min(20_000, req.maxEntries * 50));
    const entries = parseSitecoreLog(text).filter((e) => matchesLogFilter(e, req));
    const base = { source: this.describe(), scanned: [this.container] };
    if (entries.length > 0 || req.levels?.length) return { ...base, entries: entries.slice(-req.maxEntries) };

    // Output is not in Sitecore log format (e.g. LogMonitor/IIS output): fall back to raw lines.
    const needle = req.contains?.toLowerCase();
    const rawLines = text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "" && (!needle || l.toLowerCase().includes(needle)))
      .slice(-req.maxEntries);
    return { ...base, entries: [], rawLines };
  }
}
