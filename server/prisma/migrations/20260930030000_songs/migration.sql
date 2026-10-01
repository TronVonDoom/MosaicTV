-- Songs: a Music library's audio files, aired over the now-playing screen.
-- A song's track and disc, and its timed lyrics file; a channel's choice of
-- screen, and whether lyrics come first. Plain column adds, with defaults.

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "track" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "disc" INTEGER;
ALTER TABLE "MediaItem" ADD COLUMN "lyricsPath" TEXT;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "musicScreen" TEXT NOT NULL DEFAULT 'album';
ALTER TABLE "Channel" ADD COLUMN "lyricsFirst" BOOLEAN NOT NULL DEFAULT false;
