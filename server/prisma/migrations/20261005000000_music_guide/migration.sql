-- Songs in the guide: a run of them reads as one block an hour, named after
-- the collection it came from, unless a channel lists each song.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "musicGuide" TEXT NOT NULL DEFAULT 'hour';

-- AlterTable
ALTER TABLE "PlayoutItem" ADD COLUMN "collectionId" INTEGER;
