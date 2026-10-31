-- Forgetting a file (a library folder removed, a library deleted, a scan
-- letting go of files gone from disk) takes its guide rows along. Without an
-- index on the file, every file forgotten read the whole guide to find its
-- rows, and a folder's worth held the database — and every request — for
-- minutes.

-- CreateIndex
CREATE INDEX "PlayoutItem_mediaItemId_idx" ON "PlayoutItem"("mediaItemId");
