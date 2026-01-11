import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustStock, StockError } from '@/lib/stock';
import {
  getCurrentUserFromRequest,
  requireManagerWithBusiness,
  AuthError,
} from '@/lib/api-auth';

// Validation schema
const adjustStockSchema = z.object({
  quantity: z.number().refine((val) => val !== 0, {
    message: 'Quantity cannot be zero. Use positive to add, negative to deduct.',
  }),
  reason: z.string().min(1, 'Reason is required for stock adjustment'),
});

// POST /api/products/[id]/adjust-stock - Manual stock adjustment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Authenticate and authorize (only managers)
    const user = await getCurrentUserFromRequest(request);
    const manager = requireManagerWithBusiness(user);

    // 2. Get product ID from params
    const { id: productId } = await params;

    // 3. Validate request body
    const body = await request.json();
    const { quantity, reason } = adjustStockSchema.parse(body);

    // 4. Get product info before adjustment (for context)
    const prisma = (await import('@/lib/prisma')).prisma;
    const productBefore = await prisma.product.findUnique({
      where: { id: productId, businessId: manager.businessId! },
      select: {
        id: true,
        name: true,
        quantity: true,
      },
    });

    if (!productBefore) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Determine if adding or deducting
    const isAddition = quantity > 0;
    const absoluteQuantity = Math.abs(quantity);

    // 5. Adjust stock using your stock engine
    const result = await adjustStock(
      productId,
      manager.businessId!,
      manager.id,
      absoluteQuantity,
      `${isAddition ? 'Added' : 'Deducted'} ${absoluteQuantity} units: ${reason}`,
    );

    // 6. Return success response
    return NextResponse.json({
      success: true,
      message: `Stock ${isAddition ? 'added' : 'deducted'} successfully`,
      data: {
        stockMovement: {
          id: result.stockMovement.id,
          type: result.stockMovement.type,
          quantity: result.stockMovement.quantity,
          previousQuantity: result.stockMovement.previousQuantity,
          newQuantity: result.stockMovement.newQuantity,
          notes: result.stockMovement.notes,
          createdAt: result.stockMovement.createdAt.toISOString(),
        },
        product: {
          id: result.product.id,
          name: result.product.name,
          previousQuantity: result.product.previousQuantity,
          newQuantity: result.product.newQuantity,
        },
        adjustment: {
          originalQuantity: quantity,
          absoluteQuantity,
          isAddition,
          reason,
        },
      },
    });
  } catch (error) {
    console.error('POST /api/products/[id]/adjust-stock error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof StockError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: 'Failed to adjust stock' },
      { status: 500 },
    );
  }
}