/** Base error whose message is safe to show to the AI client (never contains secrets). */
export class SitecoreMcpError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }

  toUserMessage(): string {
    return this.hint ? `${this.message}\nHint: ${this.hint}` : this.message;
  }
}

export class ConfigError extends SitecoreMcpError {}
export class HostNotAllowedError extends SitecoreMcpError {}
export class AuthError extends SitecoreMcpError {}
export class SitecoreApiError extends SitecoreMcpError {
  constructor(
    message: string,
    readonly status: number,
    hint?: string,
  ) {
    super(message, hint);
  }
}
export class NotFoundError extends SitecoreMcpError {}

export function toUserMessage(err: unknown): string {
  if (err instanceof SitecoreMcpError) return err.toUserMessage();
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
