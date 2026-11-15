import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DockerLogSource } from "../src/adapters/logs/dockerSource.js";
import { FileLogSource } from "../src/adapters/logs/fileSource.js";
import { dateFromLogFileName, parseSitecoreLog } from "../src/adapters/logs/parser.js";

const SAMPLE = [
  "4560 08:15:31 INFO  Sitecore started",
  "ManagedPoolThread #3 08:15:40 WARN  Slow job",
  "6420 08:16:02 ERROR Rendering failed",
  "Exception: System.NullReferenceException",
  "Message: Object reference not set",
  "   at Foo.Bar()",
  "",
  "Heartbeat 08:17:00 INFO  Health.Check",
].join("\r\n");

describe("parseSitecoreLog", () => {
  it("parses entries and keeps stack traces together", () => {
    const entries = parseSitecoreLog(SAMPLE, { date: "2026-11-15", file: "log.x.txt" });
    expect(entries).toHaveLength(4);
    expect(entries[1]).toMatchObject({ thread: "ManagedPoolThread #3", level: "WARN", timestamp: "2026-11-15T08:15:40" });
    expect(entries[2]!.message).toContain("NullReferenceException");
    expect(entries[2]!.message).toContain("at Foo.Bar()");
    expect(entries[3]!.message).toBe("Health.Check");
  });

  it("extracts the date from file names", () => {
    expect(dateFromLogFileName("log.20261115.081500.txt")).toBe("2026-11-15");
    expect(dateFromLogFileName("log.txt")).toBeUndefined();
  });
});

describe("FileLogSource", () => {
  it("reads newest files first and filters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sclogs-"));
    const older = join(dir, "log.20261114.000000.txt");
    const newer = join(dir, "log.20261115.000000.txt");
    writeFileSync(older, "1 23:59:00 ERROR old failure\n");
    writeFileSync(newer, SAMPLE);
    writeFileSync(join(dir, "Publishing.log.20261115.txt"), "1 08:00:00 ERROR ignored\n");
    utimesSync(older, new Date("2026-11-14"), new Date("2026-11-14"));

    const src = new FileLogSource(dir);
    const errors = await src.tail({ levels: ["ERROR"], maxEntries: 10 });
    expect(errors.entries.map((e) => e.message.split("\n")[0])).toEqual(["old failure", "Rendering failed"]);
    expect(errors.scanned).toEqual(["log.20261115.000000.txt", "log.20261114.000000.txt"]);

    const last = await src.tail({ maxEntries: 1 });
    expect(last.entries.map((e) => e.message)).toEqual(["Health.Check"]);
    expect(last.scanned).toHaveLength(1);
  });

  it("gives a helpful error for a missing folder", async () => {
    await expect(new FileLogSource("Z:/no/such/dir").tail({ maxEntries: 5 })).rejects.toThrow(/Cannot read log folder/);
  });
});

describe("DockerLogSource", () => {
  it("parses Sitecore-format output", async () => {
    const src = new DockerLogSource("cm-1", async (c, n) => {
      expect(c).toBe("cm-1");
      expect(n).toBe(500);
      return SAMPLE;
    });
    const res = await src.tail({ levels: ["ERROR"], maxEntries: 10 });
    expect(res.entries).toHaveLength(1);
  });

  it("falls back to raw lines for non-Sitecore output", async () => {
    const src = new DockerLogSource("cm-1", async () => '{"Source":"EventLog","Message":"boom"}\n{"Message":"ok"}\n');
    const res = await src.tail({ contains: "boom", maxEntries: 10 });
    expect(res.entries).toEqual([]);
    expect(res.rawLines).toEqual(['{"Source":"EventLog","Message":"boom"}']);
  });
});
