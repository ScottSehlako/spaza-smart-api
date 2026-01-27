import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';

// Params validation schema
const paramsSchema = z.object({
  code: z.string().min(1, 'Barcode code is required'),
});

// GET /api/barcodes/[code] - Get product by barcode
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const { code } = await params;
    const { code: barcodeCode } = paramsSchema.parse({ code });

    const barcode = await prisma.barcode.findFirst({
      where: {
        code: barcodeCode,
        businessId: authUser.businessId!, // Filter by business
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            description: true,
            sku: true,
            unitOfMeasure: true,
            quantity: true,
            costPerUnit: true,
            sellingPrice: true,
            reorderThreshold: true,
            optimalQuantity: true,
            isConsumable: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            createdBy: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!barcode) {
      return NextResponse.json(
        { success: false, error: 'Barcode not found' },
        { status: 404 },
      );
    }

    if (!barcode.product.isActive) {
      return NextResponse.json(
        { success: false, error: 'Product is inactive' },
        { status: 400 },
      );
    }

    const formattedProduct = {
      ...barcode.product,
      barcode: barcode.code,
      createdBy: barcode.product.createdBy.name,
      createdAt: barcode.product.createdAt.toISOString(),
      updatedAt: barcode.product.updatedAt.toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: {
        product: formattedProduct,
        barcode: {
          id: barcode.id,
          code: barcode.code,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/barcodes/[code] error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid barcode code',
          details: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}