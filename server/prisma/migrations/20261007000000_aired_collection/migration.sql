-- The guide shows what already aired, from the history once the playout lets
-- it go: a run of songs there reads as a block an hour, named after the
-- collection it came from, as it did when it was on.

-- AlterTable
ALTER TABLE "Aired" ADD COLUMN "collectionId" INTEGER;
