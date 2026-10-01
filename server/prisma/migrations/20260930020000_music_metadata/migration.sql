-- Music videos get their metadata: a music library reads its videos' .nfo
-- files and their own tags (TMDB and TheTVDB have no music videos), so one
-- still on the default sources takes music's. No schema change.
UPDATE "Library" SET "metadataSources" = 'nfo,embedded' WHERE "kind" = 'music' AND "metadataSources" = 'nfo,tmdb,tvdb';

-- Their videos are read again: the next scan probes each once more (its tags
-- now carry an artist, an album and any cover picture), and the metadata fetch
-- after a scan reads what it hasn't.
UPDATE "MediaItem" SET "mtimeMs" = NULL, "embedded" = NULL, "metaAt" = NULL WHERE "type" = 'music';

-- That scan runs after boot, with any other an upgrade asked for.
INSERT INTO "Setting" ("key", "value")
SELECT 'rescanLibraries', "ids" FROM (SELECT group_concat("id") AS "ids" FROM "Library" WHERE "kind" = 'music') WHERE "ids" IS NOT NULL
ON CONFLICT ("key") DO UPDATE SET "value" = "value" || ',' || excluded."value";
