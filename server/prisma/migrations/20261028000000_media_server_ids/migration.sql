-- A media server library keeps its server's own id: libraries from one
-- server share its sign-in and its live updates.

-- AlterTable
ALTER TABLE "Library" ADD COLUMN "sourceServer" TEXT;
