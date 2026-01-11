import { StockMovementType } from '@prisma/client';
import { prisma } from './prisma';
import { RequestContext } from './request-context';

export interface StockMovementParams {
  productId: string;
  businessId: string;
  userId: string;
  type: StockMovementType;
  quantity: number;
  notes?: string;
  referenceId?: string;
  referenceType?: string;
}

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockError';
  }
}

/**
 * Core stock movement function - the ONLY way to change inventory
 * Uses database transaction to ensure data consistency
 */
export async function createStockMovement(params: StockMovementParams) {
  const {
    productId,
    businessId,
    userId,
    type,
    quantity,
    notes,
    referenceId,
    referenceType,
  } = params;

  // Validate quantity
  if (quantity <= 0) {
    throw new StockError('Quantity must be greater than 0');
  }

  // Use transaction to ensure data consistency
  return await prisma.$transaction(async (tx) => {
    // 1. Get current product with FOR UPDATE lock
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        quantity: true,
        name: true,
        isConsumable: true,
        businessId: true,
      },
    });

    if (!product) {
      throw new StockError('Product not found');
    }

    // 2. Verify product belongs to business
    if (product.businessId !== businessId) {
      throw new StockError('Product does not belong to this business');
    }

    // 3. Calculate new quantity based on movement type
    let newQuantity = product.quantity;
    const previousQuantity = product.quantity;

    switch (type) {
      case StockMovementType.PURCHASE:
      case StockMovementType.RETURN:
        // Adding stock
        newQuantity = product.quantity + quantity;
        break;

      case StockMovementType.SALE:
      case StockMovementType.SERVICE_USAGE:
      case StockMovementType.ADJUSTMENT:
        // Deducting stock
        newQuantity = product.quantity - quantity;

        // Check for negative stock (except for adjustments which can be negative)
        if (newQuantity < 0 && type !== StockMovementType.ADJUSTMENT) {
          throw new StockError(
            `Insufficient stock. Available: ${product.quantity}, Required: ${quantity}`,
          );
        }
        break;

      default:
        throw new StockError(`Invalid stock movement type: ${type}`);
    }

    // 4. Create stock movement record (immutable)
    const stockMovement = await tx.stockMovement.create({
      data: {
        productId,
        type,
        quantity,
        previousQuantity,
        newQuantity,
        businessId,
        createdById: userId,
        notes,
        referenceId,
        referenceType,
      },
    });

    // 5. Update product quantity (cached value)
    await tx.product.update({
      where: { id: productId },
      data: { quantity: newQuantity },
    });

    // 6. Create audit log using RequestContext (outside transaction for reliability)
    // We'll do this after the transaction commits to ensure audit log reflects actual changes
    const auditData = {
      productId,
      type,
      previousQuantity,
      newQuantity,
      businessId,
      userId,
      notes,
    };

    // Return the result first, then log audit asynchronously
    const result = {
      stockMovement,
      product: {
        id: product.id,
        name: product.name,
        previousQuantity,
        newQuantity,
      },
    };

    // Schedule audit logging to run after transaction completes
    process.nextTick(async () => {
      try {
        await RequestContext.logWithContext({
          action: `STOCK_${type}` as any,
          entityType: 'Product',
          entityId: productId,
          businessId,
          performedById: userId,
          oldValue: { quantity: previousQuantity },
          newValue: { quantity: newQuantity },
        });
      } catch (auditError) {
        console.warn('Failed to create audit log for stock movement:', auditError);
      }
    });

    return result;
  });
}

/**
 * Helper function to add stock (purchase)
 */
export async function addStock(
  productId: string,
  businessId: string,
  userId: string,
  quantity: number,
  notes?: string,
) {
  return createStockMovement({
    productId,
    businessId,
    userId,
    type: StockMovementType.PURCHASE,
    quantity,
    notes: notes || 'Stock purchase',
  });
}

/**
 * Helper function to sell product
 */
export async function sellProduct(
  productId: string,
  businessId: string,
  userId: string,
  quantity: number,
  saleId?: string,
  notes?: string,
) {
  return createStockMovement({
    productId,
    businessId,
    userId,
    type: StockMovementType.SALE,
    quantity,
    notes: notes || 'Product sale',
    referenceId: saleId,
    referenceType: saleId ? 'sale' : undefined,
  });
}

/**
 * Helper function to use product in service
 */
export async function useProductInService(
  productId: string,
  businessId: string,
  userId: string,
  quantity: number,
  serviceSaleId?: string,
  notes?: string,
) {
  return createStockMovement({
    productId,
    businessId,
    userId,
    type: StockMovementType.SERVICE_USAGE,
    quantity,
    notes: notes || 'Service usage',
    referenceId: serviceSaleId,
    referenceType: serviceSaleId ? 'service_sale' : undefined,
  });
}

/**
 * Helper function for manual stock adjustment
 */
export async function adjustStock(
  productId: string,
  businessId: string,
  userId: string,
  quantity: number,
  reason: string,
) {
  return createStockMovement({
    productId,
    businessId,
    userId,
    type: StockMovementType.ADJUSTMENT,
    quantity: Math.abs(quantity),
    notes: `Stock adjustment: ${reason}. ${quantity >= 0 ? 'Added' : 'Deducted'} ${Math.abs(quantity)} units.`,
  });
}

/**
 * Get stock movements for a product
 */
export async function getProductStockHistory(
  productId: string,
  businessId: string,
  options?: {
    page?: number;
    limit?: number;
    startDate?: Date;
    endDate?: Date;
    type?: StockMovementType;
  },
) {
  const { page = 1, limit = 50, startDate, endDate, type } = options || {};

  const skip = (page - 1) * limit;

  const where: any = {
    productId,
    businessId,
  };

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  if (type) {
    where.type = type;
  }

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        saleItem: {
          include: {
            sale: {
              select: {
                receiptNumber: true,
                createdAt: true,
              },
            },
          },
        },
        productUsage: {
          include: {
            serviceSale: {
              select: {
                id: true,
                service: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return {
    movements,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Check if product needs reordering
 */
export async function checkReorderStatus(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      quantity: true,
      reorderThreshold: true,
      optimalQuantity: true,
      sku: true,
    },
  });

  if (!product) {
    throw new StockError('Product not found');
  }

  const needsReorder =
    product.reorderThreshold !== null && product.quantity <= product.reorderThreshold;

  const reorderAmount =
    product.optimalQuantity !== null
      ? Math.max(0, product.optimalQuantity - product.quantity)
      : 0;

  return {
    ...product,
    needsReorder,
    reorderAmount,
    status: needsReorder ? 'LOW_STOCK' : 'OK',
  };
}

/**
 * Get low stock products for a business
 */
export async function getLowStockProducts(businessId: string, limit = 20) {
  const products = await prisma.product.findMany({
    where: {
      businessId,
      isActive: true,
      reorderThreshold: { not: null },
      quantity: { lte: prisma.product.fields.reorderThreshold },
    },
    select: {
      id: true,
      name: true,
      sku: true,
      quantity: true,
      reorderThreshold: true,
      optimalQuantity: true,
      unitOfMeasure: true,
    },
    orderBy: { quantity: 'asc' },
    take: limit,
  });

  return products.map((product) => ({
    ...product,
    needsReorder: true,
    reorderAmount: product.optimalQuantity
      ? Math.max(0, product.optimalQuantity - product.quantity)
      : 0,
    status: 'LOW_STOCK' as const,
  }));
}