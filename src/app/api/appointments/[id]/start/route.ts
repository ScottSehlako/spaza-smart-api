import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST /api/appointments/[id]/start - Start an appointment
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    const { id } = await params

    // 2. Check if appointment exists and belongs to business
    const appointment = await prisma.appointment.findFirst({
      where: {
        id,
        businessId: authUser.businessId!
      }
    })

    if (!appointment) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Appointment not found' 
        },
        { status: 404 }
      )
    }

    // 3. Check permissions
    // Only assigned employee or manager can start appointment
    const isAssignedEmployee = appointment.assignedToId === authUser.id
    const isManager = authUser.role === 'MANAGER'
    
    if (!isAssignedEmployee && !isManager) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Only assigned employee or manager can start appointment' 
        },
        { status: 403 }
      )
    }

    // 4. Validate appointment can be started
    if (appointment.status !== 'SCHEDULED') {
      return NextResponse.json(
        { 
          success: false,
          error: `Appointment cannot be started from ${appointment.status} status. Must be SCHEDULED.`
        },
        { status: 400 }
      )
    }

    // 5. Check if appointment time has arrived (within 15 minutes of scheduled time)
    const now = new Date()
    const scheduledTime = new Date(appointment.scheduledDate)
    const fifteenMinutesBefore = new Date(scheduledTime.getTime() - 15 * 60000)
    const fifteenMinutesAfter = new Date(scheduledTime.getTime() + 15 * 60000)

    if (now < fifteenMinutesBefore) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Appointment cannot be started more than 15 minutes before scheduled time'
        },
        { status: 400 }
      )
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
                    unitOfMeasure: true
                  }
                }
              }
            }
          }
        },
        assignedTo: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    // 7. Format response
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
        suggestedProducts: startedAppointment.service.suggestedProducts.map(sp => ({
          id: sp.id,
          product: {
            id: sp.product.id,
            name: sp.product.name,
            quantity: sp.product.quantity,
            unitOfMeasure: sp.product.unitOfMeasure
          },
          suggestedQuantity: sp.suggestedQuantity
        }))
      },
      assignedTo: startedAppointment.assignedTo ? {
        id: startedAppointment.assignedTo.id,
        name: startedAppointment.assignedTo.name
      } : null
    }

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
      message: 'Appointment started successfully'
    })

  } catch (error) {
    console.error('POST /api/appointments/[id]/start error:', error)

    if (error instanceof AuthError) {
      return NextResponse.json(
        { 
          success: false,
          error: error.message 
        },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error' 
      },
      { status: 500 }
    )
  }
}