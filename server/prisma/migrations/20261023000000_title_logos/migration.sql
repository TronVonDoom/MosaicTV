-- A title's logo: its name as artwork, a transparent PNG, shown where its
-- name is. A show's or movie's from TMDB, TheTVDB or its media server, and a
-- logo file beside the media (clearlogo.png, logo.png), which comes first.

-- AlterTable
ALTER TABLE "Show" ADD COLUMN "tmdbLogoPath" TEXT;

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN "logoPath" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tmdbLogoPath" TEXT;
