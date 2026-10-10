-- Promos in breaks: one break in N ends on a promo for something coming up
-- later on the channel. 0 = none, as every channel was.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "promoEvery" INTEGER NOT NULL DEFAULT 0;
