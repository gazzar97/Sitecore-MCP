import http from "node:http";
import https from "node:https";
import { SitecoreMcpError } from "../errors.js";

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

/**
 * Minimal HTTP(S) transport built on node:http(s) so we can accept self-signed
 * local dev certificates per instance (FR-CON-04) without extra dependencies.
 */
export function createNodeTransport(opts: { allowInsecureTls: boolean }): HttpTransport {
  const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: !opts.allowInsecureTls });
  const httpAgent = new http.Agent({ keepAlive: true });

  return (req) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const url = new URL(req.url);
      const isHttps = url.protocol === "https:";
      const lib = isHttps ? https : http;
      const headers: Record<string, string> = { ...req.headers };
      if (req.body !== undefined) headers["content-length"] = String(Buffer.byteLength(req.body));

      const r = lib.request(
        url,
        { method: req.method, headers, agent: isHttps ? httpsAgent : httpAgent, timeout: req.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) {
              r.destroy(new SitecoreMcpError(`Response from ${url.pathname} exceeded ${MAX_RESPONSE_BYTES} bytes`));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
          );
          res.on("error", reject);
        },
      );
      r.on("timeout", () => r.destroy(new SitecoreMcpError(`Request to ${url.origin} timed out after ${req.timeoutMs} ms`)));
      r.on("error", (e: NodeJS.ErrnoException) => reject(wrapNetworkError(e, url)));
      if (req.body !== undefined) r.write(req.body);
      r.end();
    });
}

function wrapNetworkError(e: NodeJS.ErrnoException, url: URL): Error {
  if (e instanceof SitecoreMcpError) return e;
  const code = e.code ?? "";
  if (code === "ECONNREFUSED")
    return new SitecoreMcpError(`Connection refused by ${url.origin}.`, "Is the Sitecore instance (IIS site or Docker containers) running?");
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
    return new SitecoreMcpError(
      `TLS certificate for ${url.host} is not trusted (${code}).`,
      `Trust the local dev certificate, or set "allowInsecureTls": true for this instance.`,
    );
  return new SitecoreMcpError(`Network error calling ${url.origin}: ${e.message}`);
}
