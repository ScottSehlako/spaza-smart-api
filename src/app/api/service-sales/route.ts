import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Validation schema for service sale creation
const createServiceSaleSchema = z.object({
  serviceId: z.string().cuid('Invalid service ID'),
  appointmentId: z.string().cuid('Invalid appointment ID').optional(),
  actualUsage: z.array(
    z.object({
      productId: z.string().cuid('Invalid product ID'),
      quantityUsed: z.number().positive('Quantity must be greater than 0'),
    })
  ).min(1, 'At least one product usage is required'),
  notes: z.string().optional(),
});

// POST /api/service-sales - Create a service sale (aligns with documentation)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const body = await request.json();
    const { serviceId, appointmentId, actualUsage, notes } = createServiceSaleSchema.parse(body);

    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Verify service exists and is active
      const service = await tx.service.findFirst({
        where: {
          id: serviceId,
          businessId: authUser.businessId!,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          basePrice: true,
        },
      });

      if (!service) {
        throw new Error('Service not found or inactive');
      }

      // Verify appointment if provided
      let appointment = null;
      if (appointmentId) {
        appointment = await tx.appointment.findFirst({
          where: {
            id: appointmentId,
            businessId: authUser.businessId!,
            serviceId: serviceId,
          },
        });

        if (!appointment) {
          throw new Error('Appointment not found or does not match service');
        }

        if (appointment.status !== 'SCHEDULED') {
          throw new Error('Appointment is not in scheduled state');
        }
      }

      // Create service sale
      const serviceSale = await tx.serviceSale.create({
        data: {
          serviceId: serviceId,
          businessId: authUser.businessId!,
          createdById: authUser.id,
          appointment: appointment ? { connect: { id: appointment.id } } : undefined,
        },
      });

      // Validate products and record usage
      const productIds = actualUsage.map(usage => usage.productId);
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          businessId: authUser.businessId!,
          isActive: true,
        },
      });

      if (products.length !== productIds.length) {
        throw new Error('One or more products not found or inactive');
      }

      const productUsages = [];
      for (const usage of actualUsage) {
        const product = products.find(p => p.id === usage.productId);
        if (!product) {
          throw new Error(`Product ${usage.productId} not found`);
        }

        // Check stock for consumable products
        if (product.isConsumable && product.quantity < usage.quantityUsed) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${product.quantity}, Required: ${usage.quantityUsed}`
          );
        }

        // Create stock movement for service usage
        const stockMovement = await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: 'SERVICE_USAGE',
            quantity: usage.quantityUsed,
            previousQuantity: product.quantity,
            newQuantity: product.quantity - usage.quantityUsed,
            notes: `Service: ${service.name}${notes ? ` - ${notes}` : ''}`,
            referenceId: serviceSale.id,
            referenceType: 'ServiceSale',
            businessId: authUser.businessId!,
            createdById: authUser.id,
          },
        });

        // Update product quantity
        await tx.product.update({
          where: { id: product.id },
          data: {
            quantity: product.quantity - usage.quantityUsed,
          },
        });

        // Record product usage
        const productUsage = await tx.productUsage.create({
          data: {
            serviceSaleId: serviceSale.id,
            productId: product.id,
            quantityUsed: usage.quantityUsed,
            stockMovementId: stockMovement.id,
          },
        });

        productUsages.push({
          ...productUsage,
          productName: product.name,
        });
      }

      // Update appointment status if applicable
      if (appointment) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'COMPLETED',
            serviceSaleId: serviceSale.id,
          },
        });
      }

      return {
        serviceSale: {
          ...serviceSale,
          createdAt: serviceSale.createdAt.toISOString(),
          updatedAt: serviceSale.updatedAt.toISOString(),
        },
        service,
        productUsages,
        appointmentUpdated: !!appointment,
      };
    });

    // Create audit log
    await RequestContext.logWithContext({
      action: 'CREATE',
      entityType: 'ServiceSale',
      entityId: result.serviceSale.id,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      newValue: {
        serviceId: serviceId,
        serviceName: result.service.name,
        appointmentId: appointmentId || null,
        productCount: result.productUsages.length,
        totalProductsUsed: result.productUsages.reduce((sum, usage) => sum + usage.quantityUsed, 0),
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Service sale created successfully',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/service-sales error:', error);

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

    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 401 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}

// GET /api/service-sales - List service sales
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const serviceId = searchParams.get('serviceId');
    const skip = (page - 1) * limit;

    const where: any = {
      businessId: authUser.businessId!,
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (serviceId) {
      where.serviceId = serviceId;
    }

    const [serviceSales, total] = await Promise.all([
      prisma.serviceSale.findMany({
        where,
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
        skip,
        take: limit,
      }),
      prisma.serviceSale.count({ where }),
    ]);

    const formattedSales = serviceSales.map(sale => ({
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      serviceName: sale.service.name,
      createdByName: sale.createdBy.name,
      clientName: sale.appointment?.clientName,
      clientPhone: sale.appointment?.clientPhone,
      productCount: sale.productUsages.length,
      totalProductsUsed: sale.productUsages.reduce((sum, usage) => sum + usage.quantityUsed, 0),
    }));

    return NextResponse.json({
      success: true,
      data: {
        serviceSales: formattedSales,
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
    console.error('GET /api/service-sales error:', error);

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