-- Songs filed under their album's artist, as in Plex: MediaItem.artist holds
-- it once a scan has read the album-artist tag, and this the song's own credit
-- when that's someone else. A plain column add, empty on every existing row
-- until its library's next scan.

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "trackArtist" TEXT;
