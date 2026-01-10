import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { updateServiceSchema } from '@/lib/validations/service'
import { getCurrentUserFromRequest, requireBusinessAccess, requireManagerWithBusiness, AuthError } from '@/lib/api-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/services/[id] - Get a specific service
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    const { id } = await params

    // 2. Fetch the service
    const service = await prisma.service.findFirst({
      where: {
        id,
        businessId: authUser.businessId!
      },
      include: {
        suggestedProducts: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                description: true,
                quantity: true,
                unitOfMeasure: true,
                sellingPrice: true,
                costPerUnit: true,
                isActive: true
              }
            }
          }
        },
        _count: {
          select: {
            serviceSales: true,
            appointments: true
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    if (!service) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Service not found' 
        },
        { status: 404 }
      )
    }

    // 3. Format response
    const formattedService = {
      ...service,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
      suggestedProducts: service.suggestedProducts.map(sp => ({
        ...sp,
        product: {
          ...sp.product,
          quantity: Number(sp.product.quantity)
        }
      })),
      stats: service._count,
      createdBy: service.createdBy.name
    }

    return NextResponse.json({
      success: true,
      data: formattedService
    })

  } catch (error) {
    console.error('GET /api/services/[id] error:', error)

    if (error instanceof AuthError) {
      return NextResponse.json(
        { 
          success: false,
          error: error.message // FIXED: Changed from error to error.message
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

// PATCH /api/services/[id] - Update a service
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user (must be manager)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireManagerWithBusiness(user)

    const { id } = await params
    const body = await request.json()
    
    // Filter out durationMinutes if present (not in Prisma model)
    const filteredBody = { ...body }
    delete filteredBody.durationMinutes
    
    const validatedData = updateServiceSchema.parse(filteredBody)

    // 2. Check if service exists and belongs to user's business
    const existingService = await prisma.service.findFirst({
      where: {
        id,
        businessId: authUser.businessId!
      }
    })

    if (!existingService) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Service not found' 
        },
        { status: 404 }
      )
    }

    // 3. If name is being updated, check for duplicates
    if (validatedData.name && validatedData.name !== existingService.name) {
      const duplicateService = await prisma.service.findFirst({
        where: {
          businessId: authUser.businessId!,
          name: validatedData.name,
          id: { not: id }
        }
      })

      if (duplicateService) {
        return NextResponse.json(
          { 
            success: false,
            error: 'A service with this name already exists in your business' 
          },
          { status: 400 }
        )
      }
    }

    // 4. Update the service
    const updatedService = await prisma.service.update({
      where: { id },
      data: validatedData,
      include: {
        suggestedProducts: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                quantity: true
              }
            }
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    // 5. Format response
    const formattedService = {
      ...updatedService,
      createdAt: updatedService.createdAt.toISOString(),
      updatedAt: updatedService.updatedAt.toISOString(),
      createdBy: updatedService.createdBy.name
    }

    return NextResponse.json({
      success: true,
      data: formattedService,
      message: 'Service updated successfully'
    })

  } catch (error) {
    console.error('PATCH /api/services/[id] error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Invalid input data', 
          details: error.issues 
        },
        { status: 400 }
      )
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { 
          success: false,
          error: error.message // FIXED: Changed from error to error.message
        },
        { status: 401 }
      )
    }

    // Handle Prisma errors
    if (error instanceof Error) {
      // Check for unique constraint violation
      if (error.message.includes('Unique constraint failed')) {
        return NextResponse.json(
          { 
            success: false,
            error: 'A service with this name already exists' 
          },
          { status: 400 }
        )
      }
      
      // Check for foreign key constraint
      if (error.message.includes('Foreign key constraint failed')) {
        return NextResponse.json(
          { 
            success: false,
            error: 'Invalid reference in update data' 
          },
          { status: 400 }
        )
      }
    }

    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : undefined
      },
      { status: 500 }
    )
  }
}

// DELETE /api/services/[id] - Delete a service (soft delete by marking as inactive)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user (must be manager)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireManagerWithBusiness(user)

    const { id } = await params

    // 2. Check if service exists and belongs to user's business
    const existingService = await prisma.service.findFirst({
      where: {
        id,
        businessId: authUser.businessId!
      },
      include: {
        serviceSales: {
          take: 1
        }
      }
    })

    if (!existingService) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Service not found' 
        },
        { status: 404 }
      )
    }

    // 3. Check if service has any sales (prevent deletion of services with history)
    if (existingService.serviceSales.length > 0) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Cannot delete service with existing sales. Mark as inactive instead.' 
        },
        { status: 400 }
      )
    }

    // 4. Delete the service (hard delete since no sales exist)
    await prisma.service.delete({
      where: { id }
    })

    return NextResponse.json({
      success: true,
      message: 'Service deleted successfully'
    })

  } catch (error) {
    console.error('DELETE /api/services/[id] error:', error)

    if (error instanceof AuthError) {
      return NextResponse.json(
        { 
          success: false,
          error: error.message // FIXED: Changed from error to error.message
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