import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createServiceSchema, serviceQuerySchema } from '@/lib/validations/service'
import { getCurrentUserFromRequest, requireBusinessAccess, requireManagerWithBusiness, AuthError } from '@/lib/api-auth'

// GET /api/services - List all services for the business
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    // 2. Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams
    
    // Create a clean query object with defaults
    const queryInput: Record<string, any> = {
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50'
    }

    // Only add optional fields if they exist
    const optionalFields = ['search', 'isActive', 'minPrice', 'maxPrice']
    optionalFields.forEach(field => {
      const value = searchParams.get(field)
      if (value !== null) {
        queryInput[field] = value
      }
    })

    // Now validate
    const query = serviceQuerySchema.parse(queryInput)

    const { page, limit, search, isActive, minPrice, maxPrice } = query
    const skip = (page - 1) * limit

    // 3. Build where clause
    const where: any = {
      businessId: authUser.businessId!
    }

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    }

    // Active/inactive filter
    if (isActive !== undefined) {
      where.isActive = isActive
    }

    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {}
      if (minPrice !== undefined) {
        where.basePrice.gte = minPrice
      }
      if (maxPrice !== undefined) {
        where.basePrice.lte = maxPrice
      }
    }

    // 4. Fetch services with pagination
    const [services, total] = await Promise.all([
      prisma.service.findMany({
        where,
        include: {
          suggestedProducts: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  quantity: true,
                  unitOfMeasure: true,
                  sellingPrice: true
                }
              }
            }
          },
          _count: {
            select: {
              serviceSales: true,
              appointments: true
            }
          }
        },
        orderBy: [
          { isActive: 'desc' },
          { name: 'asc' }
        ],
        skip,
        take: limit
      }),
      prisma.service.count({ where })
    ])

    // 5. Format response
    const formattedServices = services.map(service => ({
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
      stats: service._count
    }))

    // 6. Return response
    return NextResponse.json({
      success: true,
      data: formattedServices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    })

  } catch (error) {
    console.error('GET /api/services error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.issues },
        { status: 400 }
      )
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/services - Create a new service
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user (must be manager)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireManagerWithBusiness(user)

    // 2. Parse and validate request body
    const body = await request.json()
    const validatedData = createServiceSchema.parse(body)

    // 3. Check if service with same name already exists in business
    const existingService = await prisma.service.findFirst({
      where: {
        businessId: authUser.businessId!,
        name: validatedData.name
      }
    })

    if (existingService) {
      return NextResponse.json(
        { 
          success: false,
          error: 'A service with this name already exists in your business' 
        },
        { status: 400 }
      )
    }

    // 4. Create the service
    const service = await prisma.service.create({
      data: {
        name: validatedData.name,
        description: validatedData.description,
        basePrice: validatedData.basePrice,
        isActive: validatedData.isActive,
        businessId: authUser.businessId!,
        createdById: authUser.id
      },
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
        }
      }
    })

    // 5. Format response
    const formattedService = {
      ...service,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString()
    }

    return NextResponse.json({
      success: true,
      data: formattedService,
      message: 'Service created successfully'
    }, { status: 201 })

  } catch (error) {
    console.error('POST /api/services error:', error)
    
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
          error: error
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