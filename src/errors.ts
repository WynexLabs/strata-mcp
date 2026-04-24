export class StrataApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = "StrataApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
