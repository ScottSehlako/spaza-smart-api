import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context'; // ADD THIS IMPORT

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/appointments/[id]/complete - Complete an appointment
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
        serviceSale: true,
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
    // Only assigned employee or manager can complete appointment
    const isAssignedEmployee = appointment.assignedToId === authUser.id;
    const isManager = authUser.role === 'MANAGER';

    if (!isAssignedEmployee && !isManager) {
      return NextResponse.json(
        {
          success: false,
          error: 'Only assigned employee or manager can complete appointment',
        },
        { status: 403 },
      );
    }

    // 4. Validate appointment can be completed
    if (appointment.status !== 'IN_PROGRESS') {
      return NextResponse.json(
        {
          success: false,
          error: `Appointment cannot be completed from ${appointment.status} status. Must be IN_PROGRESS.`,
        },
        { status: 400 },
      );
    }

    // 5. Check if service sale already exists (appointment already completed)
    if (appointment.serviceSale) {
      return NextResponse.json(
        {
          success: false,
          error: 'Appointment already has a completed service sale',
        },
        { status: 400 },
      );
    }

    // 6. Complete the appointment
    const completedAppointment = await prisma.appointment.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            basePrice: true,
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

    // 7. Create audit log for appointment completion using RequestContext
    await RequestContext.logWithContext({
      action: 'APPOINTMENT_COMPLETED',
      entityType: 'Appointment',
      entityId: appointmentId,
      businessId: businessId!,
      performedById: userId!,
      oldValue: {
        status: 'IN_PROGRESS',
        clientName: appointment.clientName,
        serviceName: appointment.service.name,
        assignedTo: appointment.assignedTo?.name || 'Unassigned',
      },
      newValue: {
        status: 'COMPLETED',
        clientName: completedAppointment.clientName,
        serviceName: completedAppointment.service.name,
        assignedTo: completedAppointment.assignedTo?.name || 'Unassigned',
        completedAt: completedAppointment.updatedAt.toISOString(),
      },
    });

    // 8. Format response
    const formattedAppointment = {
      id: completedAppointment.id,
      clientName: completedAppointment.clientName,
      serviceName: completedAppointment.service.name,
      basePrice: completedAppointment.service.basePrice,
      completedAt: new Date().toISOString(),
      status: completedAppointment.status,
      assignedTo: completedAppointment.assignedTo
        ? {
            id: completedAppointment.assignedTo.id,
            name: completedAppointment.assignedTo.name,
          }
        : null,
      notes: 'Appointment completed. Use /api/services/[id]/execute to record service sale with product usage.',
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
      message: 'Appointment marked as completed. Now execute the service to record product usage and payment.',
    });
  } catch (error) {
    console.error('POST /api/appointments/[id]/complete error:', error);

    // Log error to audit trail
    if (userId && businessId && appointmentId) {
      try {
        await RequestContext.logWithContext({
          action: 'APPOINTMENT_COMPLETION_FAILED',
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
        console.error('Failed to log appointment completion error:', auditError);
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