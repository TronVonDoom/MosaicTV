-- A channel can be a guide channel: its picture is every other channel's now
-- and next, scrolling, with a clock — over songs from its rotation, if it has
-- any. Every channel so far is a normal one.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "Channel" ADD COLUMN "guideLook" TEXT NOT NULL DEFAULT 'classic';
