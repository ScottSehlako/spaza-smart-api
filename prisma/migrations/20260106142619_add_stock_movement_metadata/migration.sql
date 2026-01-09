-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "referenceId" TEXT,
ADD COLUMN     "referenceType" TEXT;

-- CreateIndex
CREATE INDEX "StockMovement_referenceId_idx" ON "StockMovement"("referenceId");
