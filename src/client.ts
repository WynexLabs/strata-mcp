import { StrataApiError } from "./errors.js";

const DEFAULT_BASE_URL = "https://project-strata.wynexlabs.studio";
const USER_AGENT = "strata-mcp/0.1.0";

export interface StrataClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
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

export class StrataClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: StrataClientOptions) {
    if (!opts.apiKey || typeof opts.apiKey !== "string") {
      throw new Error("STRATA_API_KEY is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
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
      });
    } catch (err) {
      throw new StrataApiError(
        "NETWORK_ERROR",
        `Upstream request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }

    const text = await res.text();
    let parsed: StrataV1Envelope<T> | null = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as StrataV1Envelope<T>;
      } catch {
        throw new StrataApiError(
          "UPSTREAM_NON_JSON",
          `Upstream returned non-JSON body (HTTP ${res.status}): ${text.slice(0, 200)}`,
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

    return parsed.data;
  }
}
