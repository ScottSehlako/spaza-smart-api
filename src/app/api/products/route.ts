// src/app/api/sales/product/route.ts - ACTUAL SALES ENDPOINT
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sellProduct, StockError } from '@/lib/stock';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Validation schema for product sale
const productSaleSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().cuid('Invalid product ID'),
      quantity: z.number().positive('Quantity must be greater than 0'),
    }),
  ).min(1, 'At least one product is required'),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/sales/product - Create a product sale
export async function POST(request: NextRequest) {
  let saleId: string | null = null;
  let businessId: string | null = null;
  let userId: string | null = null;

  try {
    // 1. Authenticate user (employees and managers can make sales)
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);
    
    businessId = authUser.businessId!;
    userId = authUser.id;

    // 2. Parse and validate request body
    const body = await request.json();
    const validatedData = productSaleSchema.parse(body);

    // 3. Create sale with transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create sale record
      const sale = await tx.sale.create({
        data: {
          customerName: validatedData.customerName || null,
          customerPhone: validatedData.customerPhone || null,
          totalAmount: 0, // Will be calculated
          businessId: authUser.businessId!,
          createdById: authUser.id,
          status: 'COMPLETED',
        },
      });

      saleId = sale.id;

      let totalAmount = 0;
      const saleItems = [];
      const stockMovementResults = [];

      // Process each product in the sale
      for (const item of validatedData.items) {
        // Get product details
        const product = await tx.product.findUnique({
          where: {
            id: item.productId,
            businessId: authUser.businessId!,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            sellingPrice: true,
            quantity: true,
          },
        });

        if (!product) {
          throw new Error(`Product ${item.productId} not found or inactive`);
        }

        // Check stock availability
        if (product.quantity < item.quantity) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${product.quantity}, Required: ${item.quantity}`,
          );
        }

        const itemTotal = product.sellingPrice * item.quantity;
        totalAmount += itemTotal;

        // Deduct stock using the stock engine
        const stockResult = await sellProduct(
          item.productId,
          authUser.businessId!,
          authUser.id,
          item.quantity,
          sale.id,
          `Sale: ${product.name} x${item.quantity}`,
        );

        // Create sale item
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: product.sellingPrice,
            totalPrice: itemTotal,
            stockMovementId: stockResult.stockMovement.id,
          },
        });

        saleItems.push({
          id: saleItem.id,
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: product.sellingPrice,
          totalPrice: itemTotal,
        });

        stockMovementResults.push(stockResult);
      }

      // Update sale total
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: { totalAmount },
        select: {
          id: true,
          receiptNumber: true,
          customerName: true,
          customerPhone: true,
          totalAmount: true,
          status: true,
          createdAt: true,
        },
      });

      return {
        sale: updatedSale,
        items: saleItems,
        stockMovements: stockMovementResults,
      };
    });

    // 4. Create audit log for the sale using RequestContext
    await RequestContext.logWithContext({
      action: 'SALE',
      entityType: 'Sale',
      entityId: result.sale.id,
      businessId: businessId!,
      performedById: userId!,
      newValue: {
        receiptNumber: result.sale.receiptNumber,
        totalAmount: result.sale.totalAmount,
        itemCount: result.items.length,
        customerName: result.sale.customerName,
        customerPhone: result.sale.customerPhone,
        timestamp: result.sale.createdAt.toISOString(),
      },
    });

    // 5. Return success response
    return NextResponse.json(
      {
        success: true,
        message: 'Sale completed successfully',
        data: {
          sale: {
            ...result.sale,
            createdAt: result.sale.createdAt.toISOString(),
          },
          items: result.items,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/sales/product error:', error);

    // Log error to audit trail
    if (userId && businessId) {
      try {
        await RequestContext.logWithContext({
          action: 'SALE_FAILED',
          entityType: 'Sale',
          entityId: saleId || 'unknown',
          businessId: businessId,
          performedById: userId,
          newValue: {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditError) {
        console.error('Failed to log sale error:', auditError);
      }
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input data',
          details: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof StockError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 401 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to process sale' },
      { status: 500 },
    );
  }
}

// GET /api/sales/product - Get sales history
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const skip = (page - 1) * limit;

    const where: any = {
      businessId: authUser.businessId!,
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          saleItems: {
            include: {
              product: {
                select: {
                  name: true,
                  sku: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ]);

    const formattedSales = sales.map((sale) => ({
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      saleItems: sale.saleItems.map((item) => ({
        ...item,
        productName: item.product.name,
      })),
      createdBy: sale.createdBy.name,
    }));

    return NextResponse.json({
      success: true,
      data: formattedSales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/sales/product error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sales' },
      { status: 500 },
    );
  }
}