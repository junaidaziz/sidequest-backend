/*
  Warnings:

  - Added the required column `updatedAt` to the `saved_missions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "saved_missions" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
