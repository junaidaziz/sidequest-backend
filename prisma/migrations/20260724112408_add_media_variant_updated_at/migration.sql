/*
  Warnings:

  - Added the required column `updatedAt` to the `MediaVariant` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- DEFAULT CURRENT_TIMESTAMP so this succeeds against any pre-existing rows
-- (e.g. from earlier test runs) — matches every other @updatedAt column's
-- migration convention in this schema. Prisma Client still manages the
-- column's value on every future write via @updatedAt; the DB default only
-- backfills rows that predate this column.
ALTER TABLE "MediaVariant" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
