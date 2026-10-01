-- One album as a collection member, as a season is of a show: its songs or
-- music videos by that artist, on that album, in one library. A plain column
-- add, empty on every existing member.

-- AlterTable
ALTER TABLE "CollectionItem" ADD COLUMN "album" TEXT;
