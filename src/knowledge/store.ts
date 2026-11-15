import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  type Manifest,
  type SectionDataMap,
  type SectionFile,
  type SectionMeta,
  type SectionName,
} from "./types.js";

export function defaultKnowledgeRoot(): string {
  return join(homedir(), ".sitecore-mcp", "knowledge");
}

export const NOTES_TEMPLATE = `# Notes for this instance

Your own knowledge about this instance. Discovery never overwrites this file,
and the MCP reads it at the start of every session. Write short rules, e.g.:

- News articles go under Home/News/<year>, named lowercase-with-hyphens.
- Use the "Hero" rendering, not the legacy "Promo Banner".
- Datasources for a page live in its local "Data" folder.

## Conventions

## Do / don't

## Glossary
`;

type InstanceInfo = { cmUrl: string; sitecoreVersion?: string };

/** Reads and writes one instance's knowledge folder. Writes are atomic (temp file + rename). */
export class KnowledgeStore {
  readonly dir: string;

  constructor(
    root: string,
    readonly instance: string,
  ) {
    this.dir = join(root, instance);
  }

  exists(): boolean {
    return existsSync(join(this.dir, "manifest.json"));
  }

  async readManifest(): Promise<Manifest | null> {
    return this.readJson<Manifest>("manifest.json");
  }

  async readSection<K extends SectionName>(name: K): Promise<SectionFile<SectionDataMap[K]> | null> {
    return this.readJson<SectionFile<SectionDataMap[K]>>(`${name}.json`);
  }

  async writeSection<K extends SectionName>(
    name: K,
    data: SectionDataMap[K],
    meta: Omit<SectionMeta, "generatedAt">,
    info: InstanceInfo,
  ): Promise<void> {
    const generatedAt = new Date().toISOString();
    const file: SectionFile<SectionDataMap[K]> = {
      schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      section: name,
      instance: this.instance,
      generatedAt,
      data,
    };
    await this.writeAtomic(`${name}.json`, JSON.stringify(file, null, 1));
    await this.updateManifest(info, { [name]: { ...meta, generatedAt } });
  }

  /** Records a failed section without touching its previous data file. */
  async recordSectionError(name: SectionName, error: string, durationMs: number, info: InstanceInfo): Promise<void> {
    const previous = (await this.readManifest())?.sections[name];
    await this.updateManifest(info, {
      [name]: {
        status: "error",
        generatedAt: previous?.generatedAt ?? new Date().toISOString(),
        durationMs,
        count: previous?.count ?? 0,
        truncated: previous?.truncated ?? false,
        error,
      },
    });
  }

  async readOverview(): Promise<string | null> {
    return this.readText("overview.md");
  }

  async writeOverview(markdown: string): Promise<void> {
    await this.writeAtomic("overview.md", markdown);
  }

  /** Creates notes.md from the template if missing; never overwrites. */
  async ensureNotes(): Promise<void> {
    if (!existsSync(join(this.dir, "notes.md"))) await this.writeAtomic("notes.md", NOTES_TEMPLATE);
  }

  async readNotes(): Promise<string | null> {
    return this.readText("notes.md");
  }

  private async updateManifest(info: InstanceInfo, sections: Partial<Record<SectionName, SectionMeta>>): Promise<void> {
    const current: Manifest = (await this.readManifest()) ?? {
      schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      instance: this.instance,
      cmUrl: info.cmUrl,
      updatedAt: "",
      sections: {},
    };
    const next: Manifest = {
      ...current,
      cmUrl: info.cmUrl,
      sitecoreVersion: info.sitecoreVersion ?? current.sitecoreVersion,
      updatedAt: new Date().toISOString(),
      sections: { ...current.sections, ...sections },
    };
    await this.writeAtomic("manifest.json", JSON.stringify(next, null, 1));
  }

  private async readJson<T>(file: string): Promise<T | null> {
    const text = await this.readText(file);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  private async readText(file: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir, file), "utf8");
    } catch {
      return null;
    }
  }

  private async writeAtomic(file: string, content: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, file);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, target);
  }
}
