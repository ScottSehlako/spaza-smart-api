import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { updateAppointmentSchema } from '@/lib/validations/appointment';
import {
  getCurrentUserFromRequest,
  requireBusinessAccess,
  requireManagerWithBusiness,
  AuthError,
} from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context'; // ADD THIS IMPORT

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/appointments/[id] - Get a specific appointment
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const { id } = await params;

    // 2. Fetch the appointment
    const appointment = await prisma.appointment.findFirst({
      where: {
        id,
        businessId: authUser.businessId!,
      },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            description: true,
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
                    sellingPrice: true,
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
            email: true,
            phone: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        serviceSale: {
          include: {
            productUsages: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    quantity: true,
                  },
                },
              },
            },
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

    // 3. Check if employee is trying to access someone else's appointment
    if (authUser.role === 'EMPLOYEE' && appointment.assignedToId !== authUser.id) {
      return NextResponse.json(
        {
          success: false,
          error: 'You can only view your own appointments',
        },
        { status: 403 },
      );
    }

    // 4. Format response
    const formattedAppointment = {
      id: appointment.id,
      clientName: appointment.clientName,
      clientPhone: appointment.clientPhone,
      scheduledDate: appointment.scheduledDate.toISOString(),
      durationMinutes: appointment.durationMinutes || appointment.service.durationMinutes,
      status: appointment.status,
      notes: appointment.notes,
      service: {
        id: appointment.service.id,
        name: appointment.service.name,
        description: appointment.service.description,
        basePrice: appointment.service.basePrice,
        durationMinutes: appointment.service.durationMinutes,
        suggestedProducts: appointment.service.suggestedProducts.map((sp) => ({
          id: sp.id,
          product: {
            id: sp.product.id,
            name: sp.product.name,
            quantity: sp.product.quantity,
            unitOfMeasure: sp.product.unitOfMeasure,
            sellingPrice: sp.product.sellingPrice,
          },
          suggestedQuantity: sp.suggestedQuantity,
        })),
      },
      assignedTo: appointment.assignedTo
        ? {
            id: appointment.assignedTo.id,
            name: appointment.assignedTo.name,
            email: appointment.assignedTo.email,
            phone: appointment.assignedTo.phone,
          }
        : null,
      createdBy: appointment.createdBy.name,
      serviceSale: appointment.serviceSale
        ? {
            id: appointment.serviceSale.id,
            createdAt: appointment.serviceSale.createdAt.toISOString(),
            productUsages: appointment.serviceSale.productUsages.map((pu) => ({
              id: pu.id,
              product: {
                id: pu.product.id,
                name: pu.product.name,
                quantity: pu.product.quantity,
              },
              quantityUsed: pu.quantityUsed,
            })),
          }
        : null,
      createdAt: appointment.createdAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
    });
  } catch (error) {
    console.error('GET /api/appointments/[id] error:', error);

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

// PATCH /api/appointments/[id] - Update an appointment
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  let appointmentId: string | null = null;
  let businessId: string | null = null;
  let userId: string | null = null;
  let oldStatus: string | null = null;
  let newStatus: string | null = null;

  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    businessId = authUser.businessId!;
    userId = authUser.id;

    const { id } = await params;
    appointmentId = id;
    const body = await request.json();
    const validatedData = updateAppointmentSchema.parse(body);

    // 2. Check if appointment exists and belongs to business
    const existingAppointment = await prisma.appointment.findFirst({
      where: {
        id,
        businessId: authUser.businessId!,
      },
      select: {
        id: true,
        clientName: true,
        status: true,
        assignedToId: true,
        service: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!existingAppointment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Appointment not found',
        },
        { status: 404 },
      );
    }

    oldStatus = existingAppointment.status;
    newStatus = validatedData.status || oldStatus;

    // 3. Check permissions
    // Employees can only update their own appointments and only certain fields
    if (authUser.role === 'EMPLOYEE') {
      if (existingAppointment.assignedToId !== authUser.id) {
        return NextResponse.json(
          {
            success: false,
            error: 'You can only update your own appointments',
          },
          { status: 403 },
        );
      }

      // Employees can only update notes and status (to IN_PROGRESS or COMPLETED)
      const allowedFields = ['notes', 'status'];
      const attemptedUpdates = Object.keys(validatedData);
      const disallowedUpdates = attemptedUpdates.filter((field) => !allowedFields.includes(field));

      if (disallowedUpdates.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Employees can only update: ${allowedFields.join(', ')}`,
          },
          { status: 403 },
        );
      }

      // Employees can only change status to IN_PROGRESS or COMPLETED
      if (validatedData.status && !['IN_PROGRESS', 'COMPLETED'].includes(validatedData.status)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Employees can only change status to IN_PROGRESS or COMPLETED',
          },
          { status: 403 },
        );
      }

      // Employees cannot complete appointments that haven't started
      if (validatedData.status === 'COMPLETED' && existingAppointment.status !== 'IN_PROGRESS') {
        return NextResponse.json(
          {
            success: false,
            error: 'Cannot complete appointment that is not in progress',
          },
          { status: 400 },
        );
      }
    }

    // 4. Validate service if being changed
    if (validatedData.serviceId) {
      const service = await prisma.service.findFirst({
        where: {
          id: validatedData.serviceId,
          businessId: authUser.businessId!,
          isActive: true,
        },
      });

      if (!service) {
        return NextResponse.json(
          {
            success: false,
            error: 'Service not found or inactive',
          },
          { status: 404 },
        );
      }
    }

    // 5. Validate assigned employee if being changed
    let newAssignedToName: string | null = null;
    if (validatedData.assignedToId) {
      const employee = await prisma.user.findFirst({
        where: {
          id: validatedData.assignedToId,
          businessId: authUser.businessId!,
          role: 'EMPLOYEE',
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!employee) {
        return NextResponse.json(
          {
            success: false,
            error: 'Employee not found or invalid',
          },
          { status: 404 },
        );
      }
      newAssignedToName = employee.name;
    }

    // 6. Validate status transitions
    if (validatedData.status) {
      const validTransitions: Record<string, string[]> = {
        SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
        IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
        COMPLETED: [],
        CANCELLED: [],
        NO_SHOW: [],
      };

      const allowedNextStatuses = validTransitions[existingAppointment.status] || [];
      if (!allowedNextStatuses.includes(validatedData.status)) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot change status from ${existingAppointment.status} to ${validatedData.status}. Allowed: ${allowedNextStatuses.join(', ') || 'none'}`,
          },
          { status: 400 },
        );
      }
    }

    // 7. Get old assigned employee name for audit log
    let oldAssignedToName: string | null = null;
    if (existingAppointment.assignedToId) {
      const oldEmployee = await prisma.user.findUnique({
        where: { id: existingAppointment.assignedToId },
        select: { name: true },
      });
      oldAssignedToName = oldEmployee?.name || null;
    }

    // 8. Update the appointment
    const updatedAppointment = await prisma.appointment.update({
      where: { id },
      data: validatedData,
      include: {
        service: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            durationMinutes: true,
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

    // 9. Create audit log for appointment update using RequestContext
    if (Object.keys(validatedData).length > 0) {
      await RequestContext.logWithContext({
        action: 'APPOINTMENT_UPDATED',
        entityType: 'Appointment',
        entityId: appointmentId,
        businessId: businessId!,
        performedById: userId!,
        oldValue: {
          status: oldStatus,
          assignedTo: oldAssignedToName,
          clientName: existingAppointment.clientName,
          serviceName: existingAppointment.service.name,
        },
        newValue: {
          status: newStatus,
          assignedTo: updatedAppointment.assignedTo?.name || 'Unassigned',
          clientName: updatedAppointment.clientName,
          serviceName: updatedAppointment.service.name,
          changes: Object.keys(validatedData),
        },
      });
    }

    // 10. Format response
    const formattedAppointment = {
      id: updatedAppointment.id,
      clientName: updatedAppointment.clientName,
      clientPhone: updatedAppointment.clientPhone,
      scheduledDate: updatedAppointment.scheduledDate.toISOString(),
      durationMinutes: updatedAppointment.durationMinutes || updatedAppointment.service.durationMinutes,
      status: updatedAppointment.status,
      notes: updatedAppointment.notes,
      service: {
        id: updatedAppointment.service.id,
        name: updatedAppointment.service.name,
        basePrice: updatedAppointment.service.basePrice,
        durationMinutes: updatedAppointment.service.durationMinutes,
      },
      assignedTo: updatedAppointment.assignedTo
        ? {
            id: updatedAppointment.assignedTo.id,
            name: updatedAppointment.assignedTo.name,
          }
        : null,
      createdAt: updatedAppointment.createdAt.toISOString(),
      updatedAt: updatedAppointment.updatedAt.toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
      message: 'Appointment updated successfully',
    });
  } catch (error) {
    console.error('PATCH /api/appointments/[id] error:', error);

    // Log error to audit trail
    if (userId && businessId && appointmentId) {
      try {
        await RequestContext.logWithContext({
          action: 'APPOINTMENT_UPDATE_FAILED',
          entityType: 'Appointment',
          entityId: appointmentId,
          businessId: businessId,
          performedById: userId,
          newValue: {
            error: error instanceof Error ? error.message : 'Unknown error',
            oldStatus,
            attemptedNewStatus: newStatus,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditError) {
        console.error('Failed to log appointment update error:', auditError);
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

// DELETE /api/appointments/[id] - Cancel an appointment
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  let appointmentId: string | null = null;
  let businessId: string | null = null;
  let userId: string | null = null;

  try {
    // 1. Authenticate user (must be manager)
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(user);

    businessId = authUser.businessId!;
    userId = authUser.id;

    const { id } = await params;
    appointmentId = id;

    // 2. Check if appointment exists and belongs to business
    const existingAppointment = await prisma.appointment.findFirst({
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

    if (!existingAppointment) {
      return NextResponse.json(
        {
          success: false,
          error: 'Appointment not found',
        },
        { status: 404 },
      );
    }

    // 3. Check if appointment can be cancelled
    if (existingAppointment.status === 'COMPLETED') {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot cancel a completed appointment',
        },
        { status: 400 },
      );
    }

    // 4. Cancel the appointment (soft delete by changing status)
    const cancelledAppointment = await prisma.appointment.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        service: {
          select: {
            id: true,
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

    // 5. Create audit log for appointment cancellation using RequestContext
    await RequestContext.logWithContext({
      action: 'APPOINTMENT_CANCELLED',
      entityType: 'Appointment',
      entityId: appointmentId,
      businessId: businessId!,
      performedById: userId!,
      oldValue: {
        status: existingAppointment.status,
        clientName: existingAppointment.clientName,
        serviceName: existingAppointment.service.name,
        assignedTo: existingAppointment.assignedTo?.name || 'Unassigned',
        scheduledDate: existingAppointment.scheduledDate.toISOString(),
      },
      newValue: {
        status: 'CANCELLED',
        clientName: cancelledAppointment.clientName,
        serviceName: cancelledAppointment.service.name,
        assignedTo: cancelledAppointment.assignedTo?.name || 'Unassigned',
        cancelledAt: cancelledAppointment.updatedAt.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: cancelledAppointment.id,
        clientName: cancelledAppointment.clientName,
        serviceName: cancelledAppointment.service.name,
        status: cancelledAppointment.status,
        cancelledAt: cancelledAppointment.updatedAt.toISOString(),
      },
      message: 'Appointment cancelled successfully',
    });
  } catch (error) {
    console.error('DELETE /api/appointments/[id] error:', error);

    // Log error to audit trail
    if (userId && businessId && appointmentId) {
      try {
        await RequestContext.logWithContext({
          action: 'APPOINTMENT_CANCELLATION_FAILED',
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
        console.error('Failed to log appointment cancellation error:', auditError);
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