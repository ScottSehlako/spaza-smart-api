import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';

// Query validation schema
const querySchema = z.object({
  page: z.string().optional().default('1').transform(Number),
  limit: z.string().optional().default('50').transform(Number),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
  type: z.enum(['PRODUCT', 'SERVICE']).optional(),
});

// GET /api/sales - Get all sales (product and service sales)
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const searchParams = request.nextUrl.searchParams;
    const query = querySchema.parse({
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      search: searchParams.get('search'),
      type: searchParams.get('type'),
    });

    const { page, limit, startDate, endDate, search, type } = query;
    const skip = (page - 1) * limit;

    // Build where clause for product sales
    const productSaleWhere: any = {
      businessId: authUser.businessId!,
    };

    // Build where clause for service sales
    const serviceSaleWhere: any = {
      businessId: authUser.businessId!,
    };

    // Apply date filters
    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      productSaleWhere.createdAt = dateFilter;
      serviceSaleWhere.createdAt = dateFilter;
    }

    // Apply search filter for product sales
    if (search) {
      productSaleWhere.OR = [
        { receiptNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Apply search filter for service sales (through service name)
    if (search) {
      serviceSaleWhere.service = {
        name: { contains: search, mode: 'insensitive' },
      };
    }

    let productSales: any[] = [];
    let serviceSales: any[] = [];
    let totalSales = 0;
    let totalAmount = 0;

    // Fetch product sales if type is not 'SERVICE'
    if (type !== 'SERVICE') {
      const [productSalesData, productSalesCount, productSalesTotal] = await Promise.all([
        prisma.sale.findMany({
          where: productSaleWhere,
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
          take: type ? limit : Math.floor(limit / 2), // Split limit if fetching both types
        }),
        prisma.sale.count({ where: productSaleWhere }),
        prisma.sale.aggregate({
          where: productSaleWhere,
          _sum: { totalAmount: true },
        }),
      ]);

      productSales = productSalesData.map((sale) => ({
        ...sale,
        type: 'PRODUCT',
        saleType: 'PRODUCT',
        createdAt: sale.createdAt.toISOString(),
        updatedAt: sale.updatedAt.toISOString(),
        saleItems: sale.saleItems.map((item) => ({
          ...item,
          productName: item.product.name,
        })),
        createdBy: sale.createdBy.name,
      }));

      totalSales += productSalesCount;
      totalAmount += productSalesTotal._sum.totalAmount || 0;
    }

    // Fetch service sales if type is not 'PRODUCT'
    if (type !== 'PRODUCT') {
      const [serviceSalesData, serviceSalesCount, serviceSalesTotal] = await Promise.all([
        prisma.serviceSale.findMany({
          where: serviceSaleWhere,
          include: {
            service: {
              select: {
                name: true,
                basePrice: true,
              },
            },
            createdBy: {
              select: {
                name: true,
                email: true,
              },
            },
            appointment: {
              select: {
                clientName: true,
                clientPhone: true,
              },
            },
            productUsages: {
              include: {
                product: {
                  select: {
                    name: true,
                    unitOfMeasure: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: type ? skip : Math.floor(skip / 2),
          take: type ? limit : Math.floor(limit / 2),
        }),
        prisma.serviceSale.count({ where: serviceSaleWhere }),
        prisma.service.aggregate({
          where: { businessId: authUser.businessId! },
          _sum: { basePrice: true },
        }),
      ]);

      serviceSales = serviceSalesData.map((serviceSale) => ({
        ...serviceSale,
        type: 'SERVICE',
        saleType: 'SERVICE',
        totalAmount: serviceSale.service.basePrice, // Use service base price as total
        customerName: serviceSale.appointment?.clientName,
        customerPhone: serviceSale.appointment?.clientPhone,
        createdAt: serviceSale.createdAt.toISOString(),
        updatedAt: serviceSale.updatedAt.toISOString(),
        serviceName: serviceSale.service.name,
        createdBy: serviceSale.createdBy.name,
        productCount: serviceSale.productUsages.length,
      }));

      totalSales += serviceSalesCount;
      totalAmount += serviceSalesTotal._sum.basePrice || 0;
    }

    // Combine and sort all sales by date
    const allSales = [...productSales, ...serviceSales].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ).slice(0, limit); // Ensure we don't exceed limit

    return NextResponse.json({
      success: true,
      data: {
        sales: allSales,
        summary: {
          totalSales,
          totalAmount,
          productSalesCount: productSales.length,
          serviceSalesCount: serviceSales.length,
        },
        pagination: {
          page,
          limit,
          total: totalSales,
          totalPages: Math.ceil(totalSales / limit),
          hasNextPage: page * limit < totalSales,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/sales error:', error);

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