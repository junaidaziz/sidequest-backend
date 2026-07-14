import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sentinel stored while an operation is executing, before its real response
 * is known. No real DTO response ever contains this shape, so it's safe to
 * use as a marker distinguishing "reservation in flight" from "completed".
 */
const PENDING_MARKER = { __idempotencyPending: true } as const;

function isPending(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>).__idempotencyPending === true
  );
}

/** Parameters for a single idempotent execution. */
export interface IdempotentRunParams<T> {
  /** The authenticated caller — dedupe is always scoped to one user. */
  userId: string;
  /**
   * The client-supplied `Idempotency-Key` header, or undefined when absent.
   * When undefined the operation simply runs with no dedupe bookkeeping.
   */
  key: string | undefined;
  /** Stable identifier of the endpoint, so the same key on two endpoints doesn't collide. */
  endpoint: string;
  /** The side-effecting operation to run at most once per (userId, key, endpoint). */
  execute: () => Promise<T>;
}

/**
 * Cross-cutting request-deduplication (Decision 9). Threaded through the
 * mutating task/invite/review endpoints: given a client-generated
 * `Idempotency-Key`, the first call executes the operation and stores its
 * serialized response; any repeat call with the same key returns the stored
 * response verbatim instead of re-executing. Keyed per `(userId, key, endpoint)`.
 *
 * Deliberately minimal for M19 — a shared service future milestones can reuse
 * without introducing a global interceptor or key-expiry machinery yet.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `execute` at most once per `(userId, key, endpoint)`. With no key the
   * operation runs unconditionally (no dedupe). With a key: a stored response
   * is returned verbatim if present; otherwise this reserves the key with a
   * pending marker *before* executing, so a concurrent second caller is
   * blocked by the unique constraint before it can start its own execution —
   * not just before it stores its result. (An earlier version of this method
   * only deduped the stored response, executing first and checking for a
   * conflict after — that let two concurrent first-calls both run to
   * completion, e.g. both creating a row for the same logical "create task"
   * request. Reserve-then-execute is what actually prevents that.)
   */
  async run<T>(params: IdempotentRunParams<T>): Promise<T> {
    const { userId, key, endpoint, execute } = params;
    if (!key) {
      return execute();
    }

    const stored = await this.lookup<T>(userId, key, endpoint);
    if (stored !== null) {
      this.logger.log(
        `Idempotency hit for ${endpoint} (user ${userId}); returning stored response`,
      );
      return stored;
    }

    try {
      await this.prisma.idempotencyKey.create({
        data: { userId, key, endpoint, responseBody: PENDING_MARKER },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Someone else holds the reservation. If they've since finished,
        // replay their stored result. If they're still executing (or failed
        // without cleaning up, which shouldn't happen given the delete-on-
        // failure path below), refuse to execute a second time and tell the
        // client to retry — the same pattern Stripe's own idempotency-key
        // API uses for a concurrent in-flight collision.
        const raced = await this.lookup<T>(userId, key, endpoint);
        if (raced !== null) {
          return raced;
        }
        throw new ConflictException(
          `A request with Idempotency-Key "${key}" is already in progress for ${endpoint}. Retry shortly.`,
        );
      }
      throw error;
    }

    try {
      const result = await execute();
      // Normalize to a plain JSON value so what we persist is exactly what a
      // client received, and so nested Dates round-trip as the same ISO
      // strings the HTTP layer would have emitted.
      const responseBody = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await this.prisma.idempotencyKey.update({
        where: { userId_key_endpoint: { userId, key, endpoint } },
        data: { responseBody },
      });
      return result;
    } catch (error) {
      // The operation failed — release the reservation so a legitimate retry
      // with the same key isn't permanently stuck behind a dead placeholder.
      await this.prisma.idempotencyKey
        .delete({ where: { userId_key_endpoint: { userId, key, endpoint } } })
        .catch(() => undefined);
      throw error;
    }
  }

  /** Returns the stored response for a key, or null when none exists or it's still a pending reservation. */
  private async lookup<T>(userId: string, key: string, endpoint: string): Promise<T | null> {
    const record = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key_endpoint: { userId, key, endpoint } },
      select: { responseBody: true },
    });
    if (!record || isPending(record.responseBody)) {
      return null;
    }
    return record.responseBody as unknown as T;
  }
}
