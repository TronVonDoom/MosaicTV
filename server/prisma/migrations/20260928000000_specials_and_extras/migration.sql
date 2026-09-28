-- Leaving out specials and extras, in a library and in a collection. Plain
-- column adds. Which files are extras is filled in at the next start (see
-- tagExtras in scanner/scanner.ts, since it's read from paths), and a library
-- then drops the extras it doesn't keep — none do until asked, so the
-- featurettes filed with movies stop being movies.

-- A featurette, trailer, deleted scene… filed with a movie or show.
ALTER TABLE "MediaItem" ADD COLUMN "extra" TEXT;

-- What a library indexes.
ALTER TABLE "Library" ADD COLUMN "includeSpecials" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Library" ADD COLUMN "includeExtras" BOOLEAN NOT NULL DEFAULT false;

-- Whether a collection's whole-show picks and smart filter bring in season 0 and extras.
ALTER TABLE "Collection" ADD COLUMN "includeSpecials" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Collection" ADD COLUMN "includeExtras" BOOLEAN NOT NULL DEFAULT true;
