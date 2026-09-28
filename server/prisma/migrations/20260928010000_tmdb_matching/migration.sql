-- Fixing matches, as in Plex. How a movie or show came by its TMDB match
-- ("auto" by title and year, "manual" when picked by hand — which a refresh
-- keeps — "notFound" when a lookup found nothing, "skip" when unmatched by
-- hand), and what TMDB calls what it matched. Plain column adds.
ALTER TABLE "MediaItem" ADD COLUMN "tmdbMatch" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tmdbTitle" TEXT;
ALTER TABLE "MediaItem" ADD COLUMN "tmdbYear" INTEGER;
ALTER TABLE "Show" ADD COLUMN "tmdbMatch" TEXT;
ALTER TABLE "Show" ADD COLUMN "tmdbTitle" TEXT;
ALTER TABLE "Show" ADD COLUMN "tmdbYear" INTEGER;

-- Everything matched so far was matched by title and year.
UPDATE "MediaItem" SET "tmdbMatch" = 'auto' WHERE "tmdbId" IS NOT NULL;
UPDATE "Show" SET "tmdbMatch" = 'auto' WHERE "tmdbId" IS NOT NULL;
