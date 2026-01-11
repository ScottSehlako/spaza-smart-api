import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { executeServiceSchema } from '@/lib/validations/service';
import { createStockMovement } from '@/lib/stock';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context'; // ADD THIS IMPORT

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/services/[id]/execute - Execute/complete a service with variable product usage
export async function POST(request: NextRequest, { params }: RouteParams) {
  let serviceSaleId: string | null = null;
  let businessId: string | null = null;
  let userId: string | null = null;
  let serviceName: string | null = null;

  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    businessId = authUser.businessId!;
    userId = authUser.id;

    const { id: serviceId } = await params;
    const body = await request.json();
    const validatedData = executeServiceSchema.parse(body);

    // Start a transaction for atomic operations
    const result = await prisma.$transaction(async (tx) => {
      // 2. Verify service exists and is active
      const service = await tx.service.findFirst({
        where: {
          id: serviceId,
          businessId: authUser.businessId!,
          isActive: true,
        },
        include: {
          suggestedProducts: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!service) {
        throw new Error('Service not found or inactive');
      }

      serviceName = service.name;

      // 3. Check appointment if provided
      let appointment = null;
      if (validatedData.appointmentId) {
        appointment = await tx.appointment.findFirst({
          where: {
            id: validatedData.appointmentId,
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

      // 4. Validate all products exist and have sufficient stock
      const productIds = validatedData.actualUsage.map((usage) => usage.productId);
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

      // Check stock availability for each product
      for (const usage of validatedData.actualUsage) {
        const product = products.find((p) => p.id === usage.productId);
        if (!product) {
          throw new Error(`Product ${usage.productId} not found`);
        }

        if (product.isConsumable && product.quantity < usage.quantityUsed) {
          throw new Error(
            `Insufficient stock for ${product.name}. Available: ${product.quantity}, Required: ${usage.quantityUsed}`,
          );
        }
      }

      // 5. Create the service sale record
      const serviceSale = await tx.serviceSale.create({
        data: {
          serviceId: serviceId,
          businessId: authUser.businessId!,
          createdById: authUser.id,
          appointment: appointment ? { connect: { id: appointment.id } } : undefined,
        },
      });

      serviceSaleId = serviceSale.id;

      // 6. Record product usage and deduct stock for each product
      const productUsages = [];
      for (const usage of validatedData.actualUsage) {
        const product = products.find((p) => p.id === usage.productId)!;

        // Create stock movement for service usage
        const stockMovementResult = await createStockMovement({
          productId: product.id,
          businessId: authUser.businessId!,
          userId: authUser.id,
          type: 'SERVICE_USAGE',
          quantity: usage.quantityUsed,
          notes: `Service: ${service.name}${validatedData.notes ? ` - ${validatedData.notes}` : ''}`,
          referenceId: serviceSale.id,
          referenceType: 'ServiceSale',
        });

        // Get the stock movement ID from the result
        const stockMovementId = stockMovementResult.stockMovement.id;

        // Record product usage
        const productUsage = await tx.productUsage.create({
          data: {
            serviceSaleId: serviceSale.id,
            productId: product.id,
            quantityUsed: usage.quantityUsed,
            stockMovementId: stockMovementId,
          },
        });

        productUsages.push({
          id: productUsage.id,
          serviceSaleId: productUsage.serviceSaleId,
          productId: productUsage.productId,
          quantityUsed: productUsage.quantityUsed,
          stockMovementId: productUsage.stockMovementId,
          product: {
            id: product.id,
            name: product.name,
            quantity: product.quantity,
            unitOfMeasure: product.unitOfMeasure,
          },
        });
      }

      // 7. Update appointment status if applicable
      if (appointment) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'COMPLETED',
            serviceSaleId: serviceSale.id,
          },
        });
      }

      // 8. Return the complete result
      const serviceSaleResponse = {
        id: serviceSale.id,
        serviceId: serviceSale.serviceId,
        businessId: serviceSale.businessId,
        createdById: serviceSale.createdById,
        appointmentId: appointment?.id || null,
        createdAt: serviceSale.createdAt.toISOString(),
        updatedAt: serviceSale.updatedAt.toISOString(),
      };

      return {
        serviceSale: serviceSaleResponse,
        productUsages: productUsages,
        appointmentUpdated: !!appointment,
        totalProductsUsed: validatedData.actualUsage.length,
        service: {
          id: service.id,
          name: service.name,
          basePrice: service.basePrice,
        },
      };
    });

    // 9. Create audit log for service execution using RequestContext
    await RequestContext.logWithContext({
      action: 'SERVICE_COMPLETION',
      entityType: 'ServiceSale',
      entityId: result.serviceSale.id,
      businessId: businessId!,
      performedById: userId!,
      newValue: {
        serviceId: serviceId,
        serviceName: serviceName!,
        appointmentId: result.serviceSale.appointmentId,
        totalProductsUsed: result.totalProductsUsed,
        timestamp: result.serviceSale.createdAt,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Service executed successfully',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/services/[id]/execute error:', error);

    // Log error to audit trail
    if (userId && businessId) {
      try {
        await RequestContext.logWithContext({
          action: 'SERVICE_COMPLETION_FAILED',
          entityType: 'Service',
          entityId: serviceSaleId || 'unknown',
          businessId: businessId,
          performedById: userId,
          newValue: {
            error: error instanceof Error ? error.message : 'Unknown error',
            serviceName: serviceName || 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditError) {
        console.error('Failed to log service execution error:', auditError);
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