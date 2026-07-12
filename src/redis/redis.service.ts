import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Mirrors PrismaService's pattern (extends the client directly, owns its own
 * lifecycle) rather than a token + factory — keeps RedisModule a pure wiring
 * layer with no lifecycle logic of its own. `lazyConnect: true` + an explicit
 * `connect()` in onModuleInit (rather than connecting in the constructor)
 * means the connection attempt happens on Nest's terms during bootstrap, and
 * — same as PrismaService's spec — lets unit tests construct this class and
 * mock `connect`/`disconnect` without ever opening a real socket.
 *
 * Tuned to fail fast rather than hang requests: callers must treat every
 * cache operation as best-effort and fall back to the source of truth
 * (Postgres) on any Redis error, since caching an already-cheap 15-row table
 * is a latency/DB-load optimization, never a correctness dependency.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
