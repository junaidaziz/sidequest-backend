import { Prisma } from '@prisma/client';

/**
 * Structural view of a Prisma model delegate that the generic CmsResourceService
 * needs. Every CMS content model (CmsPage/CmsSection/…) exposes exactly these
 * methods with compatible runtime shapes, so a concrete service can hand its
 * Prisma delegate to the base via a single `as unknown as CmsDelegate<E>` cast —
 * keeping the base fully generic without resorting to `any`.
 *
 * Methods return `Prisma.PrismaPromise` (not plain `Promise`) so an array of
 * `delegate.update(...)` calls can be passed straight to `prisma.$transaction([...])`.
 */
export interface CmsDelegate<E> {
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
    skip?: number;
    take?: number;
  }): Prisma.PrismaPromise<E[]>;
  findFirst(args: { where: Record<string, unknown> }): Prisma.PrismaPromise<E | null>;
  create(args: { data: Record<string, unknown> }): Prisma.PrismaPromise<E>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Prisma.PrismaPromise<E>;
  count(args: { where?: Record<string, unknown> }): Prisma.PrismaPromise<number>;
}

/** The minimal shape the generic base relies on across every CMS entity. */
export interface CmsMutableEntity {
  id: string;
  status: string;
  sortOrder?: number;
  publishedAt?: Date | null;
  deletedAt?: Date | null;
}

/** Per-request audit context (IP + user agent) threaded from the controller. */
export interface CmsRequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}
