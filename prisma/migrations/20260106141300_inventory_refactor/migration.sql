-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "optimalQuantity" DOUBLE PRECISION,
ADD COLUMN     "reorderThreshold" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Barcode_businessId_idx" ON "Barcode"("businessId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_idx" ON "StockMovement"("businessId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");
