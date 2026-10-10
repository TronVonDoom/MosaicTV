-- A library can be read from a media server (Plex, Jellyfin, Emby): its
-- titles, shows and numbering from there, its files from disk as ever.

-- AlterTable
ALTER TABLE "Library" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'folders';
ALTER TABLE "Library" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "Library" ADD COLUMN "sourceToken" TEXT;
ALTER TABLE "Library" ADD COLUMN "sourceLibrary" TEXT;
ALTER TABLE "Library" ADD COLUMN "sourceName" TEXT;
ALTER TABLE "Library" ADD COLUMN "pathMap" TEXT;
ALTER TABLE "Library" ADD COLUMN "syncedAt" DATETIME;
ALTER TABLE "Library" ADD COLUMN "syncResult" TEXT;

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "serverKey" TEXT;

-- AlterTable
ALTER TABLE "Show" ADD COLUMN "serverKey" TEXT;
