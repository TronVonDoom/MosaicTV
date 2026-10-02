-- The album look's corners: the program before a song and the one after,
-- along the bottom of its screen. On for every channel, existing ones too.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "songsAround" BOOLEAN NOT NULL DEFAULT true;
