import { StrataApiError } from "../errors.js";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  // Index signature so this is assignable to the SDK's CallToolResult shape.
  [key: string]: unknown;
}

export function toolJsonContent(data: unknown): ToolTextResult {
  const text = JSON.stringify(data, null, 2);
  const result: ToolTextResult = {
    content: [{ type: "text", text }],
  };
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

export function toolErrorContent(code: string, message: string): ToolTextResult {
  return {
    content: [{ type: "text", text: `[${code}] ${message}` }],
    isError: true,
  };
}

export function errorToToolResult(err: unknown): ToolTextResult {
  if (err instanceof StrataApiError) {
    const details = err.details as Record<string, unknown> | undefined;
    const retryAfter = typeof details?.retryAfter === "number" ? details.retryAfter : undefined;
    const suffix = retryAfter !== undefined ? ` Retry after ${retryAfter}s.` : "";
    return toolErrorContent(err.code, `${err.message}${suffix}`);
  }
  if (err instanceof Error) {
    return toolErrorContent("TOOL_ERROR", err.message);
  }
  return toolErrorContent("TOOL_ERROR", String(err));
}
