-- Music videos as collection members: one video, or every video by an artist
-- in a library. An artist pick names the artist as the videos do; a plain
-- column add, empty on every existing member.

-- AlterTable
ALTER TABLE "CollectionItem" ADD COLUMN "artist" TEXT;
