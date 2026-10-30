-- The Bubbles look: an ident that carries the channel's show logos, and the
-- setting for whose shows it draws — the block the break falls in (the
-- default) or the whole channel's lineup.

-- AlterTable
ALTER TABLE "Filler" ADD COLUMN "lineupScope" TEXT NOT NULL DEFAULT 'block';
