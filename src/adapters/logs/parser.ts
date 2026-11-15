export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  /** ISO-like timestamp when the date is known (from the file name), otherwise just the time. */
  timestamp: string;
  thread: string;
  level: LogLevel;
  message: string;
  file?: string;
}

// Sitecore's log4net layout: "%4t %d{ABSOLUTE} %-5p %m%n", e.g. "4560 08:15:31 INFO  Sitecore started"
const LINE_RE = /^(.+?)\s+(\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s+(.*)$/;
const MAX_MESSAGE = 4000;

/**
 * Parses Sitecore log text into entries. Lines that don't start a new entry
 * (stack traces, "Exception:" blocks) are appended to the previous entry.
 */
export function parseSitecoreLog(text: string, opts: { date?: string; file?: string } = {}): LogEntry[] {
  const entries: LogEntry[] = [];
  let current: LogEntry | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = LINE_RE.exec(line.trimStart());
    if (m) {
      current = {
        timestamp: opts.date ? `${opts.date}T${m[2]}` : m[2]!,
        thread: m[1]!.trim(),
        level: m[3] as LogLevel,
        message: m[4]!,
        file: opts.file,
      };
      entries.push(current);
    } else if (current && line.trim() !== "" && current.message.length < MAX_MESSAGE) {
      current.message = `${current.message}\n${line}`.slice(0, MAX_MESSAGE);
    }
  }
  return entries;
}

/** "log.20261115.081500.txt" -> "2026-11-15" */
export function dateFromLogFileName(name: string): string | undefined {
  const m = /\.(\d{4})(\d{2})(\d{2})(?:\.\d{6})?\.txt$/i.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export interface LogFilter {
  levels?: LogLevel[];
  contains?: string;
}

export function matchesLogFilter(e: LogEntry, f: LogFilter): boolean {
  if (f.levels && f.levels.length > 0 && !f.levels.includes(e.level)) return false;
  if (f.contains && !e.message.toLowerCase().includes(f.contains.toLowerCase())) return false;
  return true;
}
