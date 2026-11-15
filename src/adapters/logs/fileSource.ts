import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { SitecoreMcpError } from "../../errors.js";
import { dateFromLogFileName, matchesLogFilter, parseSitecoreLog, type LogEntry } from "./parser.js";
import type { LogSource, LogTailRequest, LogTailResult } from "./types.js";

const MAX_FILES = 3;
const TAIL_BYTES = 4 * 1024 * 1024;

/** Reads Sitecore log files from a folder (IIS App_Data/logs or a mounted Docker volume). */
export class FileLogSource implements LogSource {
  constructor(
    private readonly folder: string,
    private readonly filePrefix = "log.",
  ) {}

  describe(): string {
    return `file:${this.folder}`;
  }

  async tail(req: LogTailRequest): Promise<LogTailResult> {
    const files = await this.latestFiles();
    const scanned: string[] = [];
    let collected: LogEntry[] = []; // oldest first

    for (const file of files) {
      scanned.push(file.name);
      const text = await readTail(join(this.folder, file.name), TAIL_BYTES);
      const entries = parseSitecoreLog(text, { date: dateFromLogFileName(file.name), file: file.name }).filter((e) =>
        matchesLogFilter(e, req),
      );
      collected = [...entries, ...collected];
      if (collected.length >= req.maxEntries) break;
    }
    return { source: this.describe(), scanned, entries: collected.slice(-req.maxEntries) };
  }

  private async latestFiles(): Promise<{ name: string; mtime: number }[]> {
    let names: string[];
    try {
      names = await readdir(this.folder);
    } catch (e) {
      throw new SitecoreMcpError(
        `Cannot read log folder "${this.folder}": ${(e as Error).message}`,
        "Check logs.path in the config. For Docker, mount the CM App_Data/logs folder to the host.",
      );
    }
    const prefix = this.filePrefix.toLowerCase();
    const candidates = names.filter((n) => n.toLowerCase().startsWith(prefix) && n.toLowerCase().endsWith(".txt"));
    const withTimes = await Promise.all(
      candidates.map(async (name) => ({ name, mtime: (await stat(join(this.folder, name))).mtimeMs })),
    );
    return withTimes.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
  }
}

/** Reads the last `maxBytes` of a file, dropping a partial first line. Works while Sitecore holds the file open. */
export async function readTail(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    return text;
  } finally {
    await handle.close();
  }
}
