-- Parental controls: a channel, or a block, locked behind a PIN in the app,
-- and a player's own lineup.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TimeBlock" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Device" ADD COLUMN "channels" TEXT;
