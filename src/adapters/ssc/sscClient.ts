import { AuthError, SitecoreApiError } from "../../errors.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../http/transport.js";
import { Semaphore } from "../../util/concurrency.js";

export interface SscClientOptions {
  baseUrl: string;
  domain: string;
  username: string;
  /** Resolved lazily so a missing env var only fails when the instance is used. */
  password: () => string;
  transport: HttpTransport;
  timeoutMs: number;
  /** Max concurrent requests to this instance (default 6). */
  maxConcurrency?: number;
}

export type Query = Record<string, string | number | boolean | undefined>;

const LOCAL_ONLY_POLICY_HINT =
  "Sitecore Services Client defaults to ServicesLocalOnlyPolicy, which rejects requests that do not originate on the CM " +
  "itself (common with Docker/Traefik). For local dev, patch the setting \"Sitecore.Services.SecurityPolicy\" to " +
  "\"Sitecore.Services.Infrastructure.Web.Http.Security.ServicesOnPolicy, Sitecore.Services.Infrastructure\".";

/** Cookie-authenticated client for the Sitecore Services Client (SSC) REST API. */
export class SscClient {
  private cookieHeader: string | undefined;
  private loginInFlight: Promise<void> | undefined;
  private readonly limiter: Semaphore;

  constructor(private readonly opts: SscClientOptions) {
    this.limiter = new Semaphore(opts.maxConcurrency ?? 6);
  }

  get baseUrl(): string {
    return this.opts.baseUrl.replace(/\/+$/, "");
  }

  get account(): string {
    return `${this.opts.domain}\\${this.opts.username}`;
  }

  async login(): Promise<void> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.doLogin().finally(() => {
        this.loginInFlight = undefined;
      });
    }
    return this.loginInFlight;
  }

  private async doLogin(): Promise<void> {
    this.cookieHeader = undefined;
    const res = await this.request({
      method: "POST",
      url: `${this.baseUrl}/sitecore/api/ssc/auth/login`,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ domain: this.opts.domain, username: this.opts.username, password: this.opts.password() }),
      timeoutMs: this.opts.timeoutMs,
    });

    if (res.status !== 200 && res.status !== 204) {
      const httpHint = this.baseUrl.startsWith("http:")
        ? ' SSC only allows login over HTTPS unless "Sitecore.Services.AllowToLoginWithHttp" is true.'
        : "";
      throw new AuthError(
        `SSC login failed for ${this.account} (HTTP ${res.status}).`,
        `Check the username/password env var.${httpHint}`,
      );
    }
    const cookies = extractCookies(res);
    if (!cookies) {
      throw new AuthError(`SSC login for ${this.account} returned HTTP ${res.status} but no auth cookie.`);
    }
    this.cookieHeader = cookies;
  }

  /** GET JSON; returns null on 404. Re-authenticates once on 401/403. */
  async getJson<T>(path: string, query: Query = {}): Promise<T | null> {
    const res = await this.authorizedGet(path, query, "application/json");
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) {
      throw new SitecoreApiError(
        `SSC GET ${path} failed with HTTP ${res.status}: ${snippet(res.body)}`,
        res.status,
        res.status === 403 ? LOCAL_ONLY_POLICY_HINT : undefined,
      );
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new SitecoreApiError(`SSC GET ${path} returned non-JSON content: ${snippet(res.body)}`, res.status);
    }
  }

  /** Authenticated GET that never throws on HTTP status. */
  async getRaw(path: string, query: Query = {}, accept = "*/*"): Promise<HttpResponse> {
    return this.authorizedGet(path, query, accept);
  }

  /**
   * Authenticated write (POST/PATCH/DELETE) with a JSON body. Throws on non-2xx.
   * Re-authenticates once on 401 only: a write that got 403 is not retried.
   */
  async write(method: "POST" | "PATCH" | "DELETE", path: string, query: Query, body?: unknown): Promise<HttpResponse> {
    const json = body === undefined ? undefined : JSON.stringify(body);
    if (!this.cookieHeader) await this.login();
    let res = await this.send(method, path, query, "application/json", json);
    if (res.status === 401) {
      await this.login();
      res = await this.send(method, path, query, "application/json", json);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new SitecoreApiError(
        `SSC ${method} ${path} failed with HTTP ${res.status}: ${snippet(res.body)}`,
        res.status,
        res.status === 403 ? `The account ${this.account} may lack write access, or: ${LOCAL_ONLY_POLICY_HINT}` : undefined,
      );
    }
    return res;
  }

  private async authorizedGet(path: string, query: Query, accept: string): Promise<HttpResponse> {
    if (!this.cookieHeader) await this.login();
    let res = await this.send("GET", path, query, accept);
    if (res.status === 401 || res.status === 403) {
      await this.login();
      res = await this.send("GET", path, query, accept);
    }
    return res;
  }

  private request(req: HttpRequest): Promise<HttpResponse> {
    return this.limiter.run(() => this.opts.transport(req));
  }

  private send(
    method: HttpRequest["method"],
    path: string,
    query: Query,
    accept: string,
    body?: string,
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = { accept, cookie: this.cookieHeader ?? "" };
    if (body !== undefined) headers["content-type"] = "application/json";
    return this.request({
      method,
      url: `${this.baseUrl}${path}${buildQuery(query)}`,
      headers,
      body,
      timeoutMs: this.opts.timeoutMs,
    });
  }
}

export function buildQuery(query: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function extractCookies(res: HttpResponse): string | undefined {
  const raw = res.headers["set-cookie"];
  if (!raw || raw.length === 0) return undefined;
  const pairs = raw
    .map((c) => c.split(";")[0]!.trim())
    .filter((c) => c.includes("=") && !c.endsWith("="));
  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

function snippet(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}
