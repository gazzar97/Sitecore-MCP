import type { LogEntry, LogFilter } from "./parser.js";

export interface LogTailRequest extends LogFilter {
  maxEntries: number;
}

export interface LogTailResult {
  source: string;
  scanned: string[];
  /** Matching entries, oldest first. */
  entries: LogEntry[];
  /** Raw lines when the output could not be parsed as Sitecore log entries (e.g. docker logs). */
  rawLines?: string[];
}

export interface LogSource {
  describe(): string;
  tail(req: LogTailRequest): Promise<LogTailResult>;
}
