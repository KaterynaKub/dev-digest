/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

/**
 * Whether retrying the same request could plausibly succeed. Lets callers
 * (and the client) distinguish "this will never work" from "try again".
 */
export type ErrorRetryHint = 'never' | 'after-backoff' | 'immediate';

export class AppError extends Error {
  /** Set by subclasses; `never` unless the failure is genuinely transient. */
  public readonly retryHint: ErrorRetryHint;

  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
    retryHint: ErrorRetryHint = 'never',
  ) {
    super(message);
    this.name = 'AppError';
    this.retryHint = retryHint;
  }

  /** Structured envelope for the HTTP layer — never leaks a stack trace. */
  toEnvelope(): { error: { code: string; message: string; details?: unknown } } {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details, 'never');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details, 'never');
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    // The one genuinely transient class — a flaky upstream is worth a retry.
    super('external_service_error', message, 502, details, 'after-backoff');
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details, 'never');
  }
}
