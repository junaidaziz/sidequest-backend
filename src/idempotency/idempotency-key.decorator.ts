import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Canonical (lowercased) header name Express exposes on `req.headers`. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Extracts the optional client-supplied `Idempotency-Key` header. Returns the
 * trimmed value, or undefined when absent/blank so callers can treat "no key" as
 * "no dedupe". A single string is expected; if a client sends the header twice,
 * Express hands back an array and we take the first entry.
 */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  },
);
