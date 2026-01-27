import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Params validation schema
const paramsSchema = z.object({
  id: z.string().cuid('Invalid service sale ID'),
});

// POST /api/service-sales/[id]/complete - Mark service sale as complete
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const { id: serviceSaleId } = await params;
    const { id } = paramsSchema.parse({ id: serviceSaleId });

    // Verify service sale exists and belongs to business
    const serviceSale = await prisma.serviceSale.findFirst({
      where: {
        id: serviceSaleId,
        businessId: authUser.businessId!,
      },
      include: {
        service: {
          select: {
            name: true,
          },
        },
        appointment: {
          select: {
            id: true,
            status: true,
          },
        },
        productUsages: {
          include: {
            product: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!serviceSale) {
      return NextResponse.json(
        { success: false, error: 'Service sale not found' },
        { status: 404 },
      );
    }

    // Check if already has an appointment (if it does, it's already "complete" in a way)
    // This endpoint is mainly for documentation alignment
    
    // Create audit log for completion
    await RequestContext.logWithContext({
      action: 'UPDATE',
      entityType: 'ServiceSale',
      entityId: serviceSaleId,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      newValue: {
        serviceName: serviceSale.service.name,
        productCount: serviceSale.productUsages.length,
        markedCompleteAt: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: serviceSale.id,
        serviceId: serviceSale.serviceId,
        serviceName: serviceSale.service.name,
        completedAt: new Date().toISOString(),
        productCount: serviceSale.productUsages.length,
        appointmentId: serviceSale.appointment?.id || null,
        appointmentStatus: serviceSale.appointment?.status || null,
      },
      message: 'Service sale marked as complete',
      note: 'Service sales are typically completed when created. This endpoint exists for documentation alignment.',
    });
  } catch (error) {
    console.error('POST /api/service-sales/[id]/complete error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid service sale ID',
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
      { success: false, error: 'Failed to complete service sale' },
      { status: 500 },
    );
  }
}