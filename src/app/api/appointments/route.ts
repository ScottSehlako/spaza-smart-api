import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createAppointmentSchema, appointmentQuerySchema } from '@/lib/validations/appointment';
import { getCurrentUserFromRequest, requireBusinessAccess, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context'; // ADD THIS IMPORT

// GET /api/appointments - List appointments with filters
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    // 2. Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams;

    // Create a clean query object with defaults
    const queryInput: Record<string, any> = {
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50',
      showPast: searchParams.get('showPast') || 'false',
    };

    // Only add optional fields if they exist
    const optionalFields = ['search', 'status', 'serviceId', 'assignedToId', 'startDate', 'endDate'];
    optionalFields.forEach((field) => {
      const value = searchParams.get(field);
      if (value !== null) {
        queryInput[field] = value;
      }
    });

    // Validate query
    const query = appointmentQuerySchema.parse(queryInput);

    const { page, limit, search, status, serviceId, assignedToId, startDate, endDate, showPast } =
      query;
    const skip = (page - 1) * limit;

    // 3. Build where clause
    const where: any = {
      businessId: authUser.businessId!,
    };

    // Date filtering
    if (!showPast) {
      // Default: only show future or today's appointments
      where.scheduledDate = { gte: new Date(new Date().setHours(0, 0, 0, 0)) };
    }

    if (startDate || endDate) {
      where.scheduledDate = {};
      if (startDate) {
        where.scheduledDate.gte = new Date(startDate);
      }
      if (endDate) {
        where.scheduledDate.lte = new Date(endDate);
      }
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // Service filter
    if (serviceId) {
      where.serviceId = serviceId;
    }

    // Assigned employee filter
    if (assignedToId) {
      where.assignedToId = assignedToId;
    } else if (authUser.role === 'EMPLOYEE') {
      // Employees can only see their own appointments
      where.assignedToId = authUser.id;
    }

    // Search filter (client name or phone)
    if (search) {
      where.OR = [
        { clientName: { contains: search, mode: 'insensitive' } },
        { clientPhone: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    // 4. Fetch appointments with pagination
    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
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
              email: true,
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
            select: {
              id: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ scheduledDate: 'asc' }, { status: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.appointment.count({ where }),
    ]);

    // 5. Format response
    const formattedAppointments = appointments.map((appointment) => ({
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
        basePrice: appointment.service.basePrice,
        durationMinutes: appointment.service.durationMinutes,
      },
      assignedTo: appointment.assignedTo
        ? {
            id: appointment.assignedTo.id,
            name: appointment.assignedTo.name,
          }
        : null,
      createdBy: appointment.createdBy.name,
      hasServiceSale: !!appointment.serviceSale,
      createdAt: appointment.createdAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
    }));

    // 6. Return response
    return NextResponse.json({
      success: true,
      data: formattedAppointments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error('GET /api/appointments error:', error);

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

// POST /api/appointments - Create a new appointment
export async function POST(request: NextRequest) {
  let appointmentId: string | null = null;
  let businessId: string | null = null;
  let userId: string | null = null;

  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    businessId = authUser.businessId!;
    userId = authUser.id;

    // Only managers can create appointments for other employees
    if (authUser.role === 'EMPLOYEE') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only managers can create appointments',
        },
        { status: 403 },
      );
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const validatedData = createAppointmentSchema.parse(body);

    // 3. Verify service exists and is active
    const service = await prisma.service.findFirst({
      where: {
        id: validatedData.serviceId,
        businessId: authUser.businessId!,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        basePrice: true,
        durationMinutes: true,
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

    // 4. Verify assigned employee exists and belongs to business (if provided)
    if (validatedData.assignedToId) {
      const employee = await prisma.user.findFirst({
        where: {
          id: validatedData.assignedToId,
          businessId: authUser.businessId!,
          role: 'EMPLOYEE',
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
    }

    // 5. Check for scheduling conflicts (optional enhancement)
    const scheduledDate = new Date(validatedData.scheduledDate);
    const duration = validatedData.durationMinutes || service.durationMinutes || 60;

    if (duration) {
      const endTime = new Date(scheduledDate.getTime() + duration * 60000);

      // Check for conflicts with existing appointments for the assigned employee
      if (validatedData.assignedToId) {
        const conflictingAppointment = await prisma.appointment.findFirst({
          where: {
            businessId: authUser.businessId!,
            assignedToId: validatedData.assignedToId,
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            OR: [
              // New appointment starts during existing appointment
              {
                scheduledDate: { lte: scheduledDate },
                AND: {
                  scheduledDate: {
                    gte: new Date(scheduledDate.getTime() - duration * 60000),
                  },
                },
              },
              // New appointment ends during existing appointment
              {
                scheduledDate: { lte: endTime },
                AND: {
                  scheduledDate: { gte: scheduledDate },
                },
              },
            ],
          },
        });

        if (conflictingAppointment) {
          return NextResponse.json(
            {
              success: false,
              error: 'Employee has a conflicting appointment at this time',
            },
            { status: 400 },
          );
        }
      }
    }

    // 6. Create the appointment
    const appointment = await prisma.appointment.create({
      data: {
        serviceId: validatedData.serviceId,
        clientName: validatedData.clientName,
        clientPhone: validatedData.clientPhone,
        scheduledDate: scheduledDate,
        durationMinutes: validatedData.durationMinutes,
        notes: validatedData.notes,
        status: 'SCHEDULED',
        assignedToId: validatedData.assignedToId,
        businessId: authUser.businessId!,
        createdById: authUser.id,
      },
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

    appointmentId = appointment.id;

    // 7. Format response
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
        basePrice: appointment.service.basePrice,
        durationMinutes: appointment.service.durationMinutes,
      },
      assignedTo: appointment.assignedTo
        ? {
            id: appointment.assignedTo.id,
            name: appointment.assignedTo.name,
          }
        : null,
      createdAt: appointment.createdAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
    };

    // 8. Create audit log for appointment creation using RequestContext
    await RequestContext.logWithContext({
      action: 'APPOINTMENT_CREATED',
      entityType: 'Appointment',
      entityId: appointment.id,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      newValue: {
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        serviceName: appointment.service.name,
        scheduledDate: appointment.scheduledDate.toISOString(),
        status: appointment.status,
        assignedTo: appointment.assignedTo?.name || 'Unassigned',
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: formattedAppointment,
        message: 'Appointment created successfully',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/appointments error:', error);

    // Log error to audit trail
    if (userId && businessId) {
      try {
        await RequestContext.logWithContext({
          action: 'APPOINTMENT_CREATION_FAILED',
          entityType: 'Appointment',
          entityId: appointmentId || 'unknown',
          businessId: businessId,
          performedById: userId,
          newValue: {
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditError) {
        console.error('Failed to log appointment creation error:', auditError);
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