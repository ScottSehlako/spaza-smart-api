// src/app/api/products/route.ts - PRODUCTS ENDPOINT
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';

// Query validation schema
// Update in products/route.ts - line 11-17
const querySchema = z.object({
  page: z.string().optional().default('1').transform(Number),
  limit: z.string().optional().default('50').transform(Number),
  search: z.string().optional().nullable().default(null),
  isActive: z.string().optional().nullable().default(null),
  lowStockOnly: z.string().optional().nullable().default(null),
}).transform(data => ({
  ...data,
  search: data.search === null ? '' : data.search,
  isActive: data.isActive === null ? false : data.isActive === 'true',
  lowStockOnly: data.lowStockOnly === null ? false : data.lowStockOnly === 'true',
}));

// GET /api/products - Get all products
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const searchParams = request.nextUrl.searchParams;
    const query = querySchema.parse({
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      search: searchParams.get('search'),
      isActive: searchParams.get('isActive'),  // for products only
      lowStockOnly: searchParams.get('lowStockOnly'),  // for products only
      startDate: searchParams.get('startDate'),  // for sales only
      endDate: searchParams.get('endDate'),  // for sales only
      type: searchParams.get('type'),  // for sales only
    });

    const { page, limit, search, isActive, lowStockOnly } = query;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      businessId: authUser.businessId!,
    };

    // Apply active filter
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Apply search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Apply low stock filter
    if (lowStockOnly) {
      where.reorderThreshold = { not: null };
      where.quantity = { lte: prisma.product.fields.reorderThreshold };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          barcode: {
            select: {
              code: true,
            },
          },
          createdBy: {
            select: {
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              saleItems: true,
              productUsages: true,
            },
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    // Format response
    const formattedProducts = products.map(product => ({
      ...product,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      barcode: product.barcode?.code || null,
      createdBy: product.createdBy.name,
      stats: {
        totalSales: product._count.saleItems,
        totalServiceUsage: product._count.productUsages,
      },
      needsReorder: product.reorderThreshold ? product.quantity <= product.reorderThreshold : false,
    }));

    return NextResponse.json({
      success: true,
      data: {
        products: formattedProducts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/products error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
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