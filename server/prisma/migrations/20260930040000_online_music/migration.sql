-- Music looked up online, for libraries that switch it on: MusicBrainz and
-- the Cover Art Archive fill in albums, years, genres and covers (in columns
-- that already exist), and LRCLIB timed lyrics for songs with none of their
-- own — kept here, since a song's lyrics file is the scanner's. A plain
-- column add.

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "lyrics" TEXT;
