import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context'; // ADD THIS IMPORT

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/appointments/[id]/start - Start an appointment
export async function POST(request: NextRequest, { params }: RouteParams) {
  let appointmentId: string | null = null;
  let businessId: string | null = null;
  let userId: string | null = null;

  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    businessId = authUser.businessId!;
    userId = authUser.id;

    const { id } = await params;
    appointmentId = id;

    // 2. Check if appointment exists and belongs to business
    const appointment = await prisma.appointment.findFirst({
      where: {
        id,
        businessId: authUser.businessId!,
      },
      include: {
        service: {
          select: {
            name: true,
          },
        },
        assignedTo: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!appointment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Appointment not found',
        },
        { status: 404 },
      );
    }

    // 3. Check permissions
    // Only assigned employee or manager can start appointment
    const isAssignedEmployee = appointment.assignedToId === authUser.id;
    const isManager = authUser.role === 'MANAGER';

    if (!isAssignedEmployee && !isManager) {
      return NextResponse.json(
        {
          success: false,
          error: 'Only assigned employee or manager can start appointment',
        },
        { status: 403 },
      );
    }

    // 4. Validate appointment can be started
    if (appointment.status !== 'SCHEDULED') {
      return NextResponse.json(
        {
          success: false,
          error: `Appointment cannot be started from ${appointment.status} status. Must be SCHEDULED.`,
        },
        { status: 400 },
      );
    }

    // 5. Check if appointment time has arrived (within 15 minutes of scheduled time)
    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledDate);
    const fifteenMinutesBefore = new Date(scheduledTime.getTime() - 15 * 60000);
    const fifteenMinutesAfter = new Date(scheduledTime.getTime() + 15 * 60000);

    if (now < fifteenMinutesBefore) {
      return NextResponse.json(
        {
          success: false,
          error: 'Appointment cannot be started more than 15 minutes before scheduled time',
        },
        { status: 400 },
      );
    }

    // 6. Start the appointment
    const startedAppointment = await prisma.appointment.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            durationMinutes: true,
            suggestedProducts: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    quantity: true,
                    unitOfMeasure: true,
                  },
                },
              },
            },
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // 7. Create audit log for appointment start using RequestContext
    await RequestContext.logWithContext({
      action: 'APPOINTMENT_STARTED',
      entityType: 'Appointment',
      entityId: appointmentId,
      businessId: businessId!,
      performedById: userId!,
      oldValue: {
        status: 'SCHEDULED',
        clientName: appointment.clientName,
        serviceName: appointment.service.name,
        assignedTo: appointment.assignedTo?.name || 'Unassigned',
      },
      newValue: {
        status: 'IN_PROGRESS',
        clientName: startedAppointment.clientName,
        serviceName: startedAppointment.service.name,
        assignedTo: startedAppointment.assignedTo?.name || 'Unassigned',
        startedAt: new Date().toISOString(),
      },
    });

    // 8. Format response
    const formattedAppointment = {
      id: startedAppointment.id,
      clientName: startedAppointment.clientName,
      scheduledDate: startedAppointment.scheduledDate.toISOString(),
      startedAt: new Date().toISOString(),
      status: startedAppointment.status,
      service: {
        id: startedAppointment.service.id,
        name: startedAppointment.service.name,
        basePrice: startedAppointment.service.basePrice,
        durationMinutes: startedAppointment.service.durationMinutes,
        suggestedProducts: startedAppointment.service.suggestedProducts.map((sp) => ({
          id: sp.id,
          product: {
            id: sp.product.id,
            name: sp.product.name,
            quantity: sp.product.quantity,
            unitOfMeasure: sp.product.unitOfMeasure,
          },
          suggestedQuantity: sp.suggestedQuantity,
        })),
      },
      assignedTo: startedAppointment.assignedTo
        ? {
            id: startedAppointment.assignedTo.id,
            name: startedAppointment.assignedTo.name,
          }
        : null,
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
      message: 'Appointment started successfully',
    });
  } catch (error) {
    console.error('POST /api/appointments/[id]/start error:', error);

    // Log error to audit trail
    if (userId && businessId && appointmentId) {
      try {
        await RequestContext.logWithContext({
          action: 'APPOINTMENT_START_FAILED',
          entityType: 'Appointment',
          entityId: appointmentId,
          businessId: businessId,
          performedById: userId,
          newValue: {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditError) {
        console.error('Failed to log appointment start error:', auditError);
      }
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 401 },
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