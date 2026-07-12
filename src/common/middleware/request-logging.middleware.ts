import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
/** Only accept inbound ids shaped like a UUID — anything else (including
 * CRLF-injection attempts aimed at forging extra log lines) is discarded
 * in favor of a freshly generated id. */
const VALID_REQUEST_ID = /^[0-9a-f-]{1,64}$/i;

function readInboundRequestId(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && VALID_REQUEST_ID.test(value) ? value : undefined;
}

/**
 * Assigns a correlation id to every request (reusing an inbound one from a
 * proxy/load balancer if it looks like a UUID) and logs method/status/duration
 * on completion. Business-event logs elsewhere (auth.service, missions.service,
 * etc.) don't carry this id — that would need request-scoped context
 * propagation (e.g. AsyncLocalStorage) threaded through every service call,
 * which is more machinery than this app's traffic volume currently justifies.
 * The id is still useful to correlate this line with AllExceptionsFilter's
 * error log for the same request via the shared `x-request-id` value.
 */
export function requestLoggingMiddleware() {
  const logger = new Logger('HTTP');

  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = readInboundRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      // req.path (no query string) — avoids logging query-param values for
      // any future endpoint that accepts sensitive data via `@Query()`.
      logger.log(`${req.method} ${req.path} ${res.statusCode} +${durationMs}ms [${requestId}]`);
    });

    next();
  };
}
