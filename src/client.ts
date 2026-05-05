import { StrataApiError } from "./errors.js";

const DEFAULT_BASE_URL = "https://project-strata.wynexlabs.studio";
const USER_AGENT = "strata-mcp/0.1.1";

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

const DEFAULT_MAX_BYTES = 512 * 1024; // 512 KiB
const MIN_MAX_BYTES = 1024;
const MAX_MAX_BYTES = 8 * 1024 * 1024; // hard ceiling 8 MiB

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const ALLOWED_REMOTE_HOSTS = new Set(["project-strata.wynexlabs.studio"]);

export interface StrataClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. Clamped to [1000, 120000]. */
  timeoutMs?: number;
  /** Max response body size in bytes. Default 512 KiB. Clamped to [1024, 8 MiB]. */
  maxBytes?: number;
}

export interface StrataV1Envelope<T> {
  // Success shape: { data, meta, error: null }.
  // Error shape:   { data: null, error: { code, message, ... } }.
  // There is NO `status` discriminator — lib/v1-response.ts in the main repo
  // is the source of truth.
  data: T | null;
  meta?: Record<string, unknown> | null;
  error: { code: string; message: string; [k: string]: unknown } | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function validateBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`STRATA_API_BASE is not a valid URL: ${raw}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLocal = LOCAL_HOSTS.has(host);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    throw new Error(
      `STRATA_API_BASE must use https:// (got ${parsed.protocol}//${host}). ` +
        `http:// is only allowed for localhost.`,
    );
  }
  if (!isLocal && !ALLOWED_REMOTE_HOSTS.has(host)) {
    throw new Error(
      `STRATA_API_BASE host '${host}' is not an allowed Strata endpoint. ` +
        `Remove STRATA_API_BASE to use the default (project-strata.wynexlabs.studio).`,
    );
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

export class StrataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(opts: StrataClientOptions) {
    if (!opts.apiKey || typeof opts.apiKey !== "string") {
      throw new Error("STRATA_API_KEY is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = validateBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = clamp(
      Number.isFinite(opts.timeoutMs) ? (opts.timeoutMs as number) : DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
    this.maxBytes = clamp(
      Number.isFinite(opts.maxBytes) ? (opts.maxBytes as number) : DEFAULT_MAX_BYTES,
      MIN_MAX_BYTES,
      MAX_MAX_BYTES,
    );
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new StrataApiError(
          "TIMEOUT",
          `Upstream request to ${path} exceeded ${this.timeoutMs}ms.`,
          0,
        );
      }
      throw new StrataApiError(
        "NETWORK_ERROR",
        `Upstream request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }

    const contentLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > this.maxBytes) {
      throw new StrataApiError(
        "OUTPUT_TOO_LARGE",
        `Upstream response (${contentLength} bytes) exceeds MCP cap of ${this.maxBytes} bytes.`,
        res.status,
      );
    }

    let text: string;
    try {
      text = await this.readCapped(res);
    } catch (err) {
      if (err instanceof StrataApiError) throw err;
      throw new StrataApiError(
        "NETWORK_ERROR",
        `Failed to read response body: ${err instanceof Error ? err.message : String(err)}`,
        res.status,
      );
    }

    let parsed: StrataV1Envelope<T> | null = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as StrataV1Envelope<T>;
      } catch {
        // Log the raw fragment to stderr only — never surface it to the MCP client.
        process.stderr.write(
          `strata-mcp: non-JSON upstream body (HTTP ${res.status}): ${text.slice(0, 200)}\n`,
        );
        throw new StrataApiError(
          "UPSTREAM_NON_JSON",
          `Upstream returned a non-JSON response (HTTP ${res.status}). Check your API key and network connectivity.`,
          res.status,
        );
      }
    }

    if (!res.ok) {
      const code = parsed?.error?.code ?? "UPSTREAM_ERROR";
      const message = parsed?.error?.message ?? `Upstream returned HTTP ${res.status}.`;
      throw new StrataApiError(code, message, res.status, parsed?.error ?? undefined);
    }

    if (!parsed || parsed.data === null || parsed.error !== null) {
      throw new StrataApiError(
        parsed?.error?.code ?? "UPSTREAM_MALFORMED",
        parsed?.error?.message ?? "Upstream response missing data.",
        res.status,
      );
    }

    // Emit remaining quota to stderr so agent operators can monitor headroom.
    const dailyRemaining = res.headers.get("x-ratelimit-daily-remaining");
    const minuteRemaining = res.headers.get("x-ratelimit-minute-remaining");
    if (dailyRemaining !== null || minuteRemaining !== null) {
      process.stderr.write(
        `strata-mcp: quota remaining — daily: ${dailyRemaining ?? "?"}, minute: ${minuteRemaining ?? "?"}\n`,
      );
    }

    return parsed.data;
  }

  private async readCapped(res: Response): Promise<string> {
    if (!res.body) return res.text();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > this.maxBytes) {
            try { await reader.cancel(); } catch { /* noop */ }
            throw new StrataApiError(
              "OUTPUT_TOO_LARGE",
              `Upstream response exceeded MCP cap of ${this.maxBytes} bytes (read ${total}+).`,
              res.status,
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder("utf-8").decode(merged);
  }
}
