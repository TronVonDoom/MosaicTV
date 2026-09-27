-- The broadcast clock: a channel's (0 = off) and a time block's own (null =
-- the channel's). Plain column adds; SQLite takes a NOT NULL column with a
-- default on a populated table.
ALTER TABLE "Channel" ADD COLUMN "grid" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TimeBlock" ADD COLUMN "grid" INTEGER;
