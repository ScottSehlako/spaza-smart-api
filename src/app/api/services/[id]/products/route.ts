import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serviceProductSchema } from '@/lib/validations/service'
import { getCurrentUserFromRequest, requireBusinessAccess, requireManagerWithBusiness, AuthError } from '@/lib/api-auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/services/[id]/products - Get suggested products for a service
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    const { id: serviceId } = await params

    // 2. Verify service exists and belongs to business
    const service = await prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId: authUser.businessId!
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

    // 3. Get suggested products
    const suggestedProducts = await prisma.serviceProduct.findMany({
      where: {
        serviceId: serviceId
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            description: true,
            quantity: true,
            unitOfMeasure: true,
            costPerUnit: true,
            sellingPrice: true,
            isActive: true,
            isConsumable: true
          }
        }
      }
    })

    // 4. Format response
    const formattedProducts = suggestedProducts.map(sp => ({
      id: sp.id,
      product: {
        ...sp.product,
        quantity: Number(sp.product.quantity)
      },
      suggestedQuantity: sp.suggestedQuantity,
      createdAt: sp.serviceId // Note: ServiceProduct doesn't have timestamps in schema
    }))

    return NextResponse.json({
      success: true,
      data: formattedProducts
    })

  } catch (error) {
    console.error('GET /api/services/[id]/products error:', error)

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

// POST /api/services/[id]/products - Add a suggested product to a service
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user (must be manager)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireManagerWithBusiness(user)

    const { id: serviceId } = await params
    const body = await request.json()
    const validatedData = serviceProductSchema.parse(body)

    // 2. Verify service exists and belongs to business
    const service = await prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId: authUser.businessId!
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

    // 3. Verify product exists and belongs to business
    const product = await prisma.product.findFirst({
      where: {
        id: validatedData.productId,
        businessId: authUser.businessId!,
        isActive: true
      }
    })

    if (!product) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Product not found or inactive' 
        },
        { status: 404 }
      )
    }

    // 4. Check if product is already suggested for this service
    const existingSuggestion = await prisma.serviceProduct.findFirst({
      where: {
        serviceId: serviceId,
        productId: validatedData.productId
      }
    })

    if (existingSuggestion) {
      return NextResponse.json(
        { 
          success: false,
          error: 'This product is already suggested for this service' 
        },
        { status: 400 }
      )
    }

    // 5. Add the suggested product
    const serviceProduct = await prisma.serviceProduct.create({
      data: {
        serviceId: serviceId,
        productId: validatedData.productId,
        suggestedQuantity: validatedData.suggestedQuantity
      },
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
    })

    // 6. Format response
    const formattedResponse = {
      id: serviceProduct.id,
      product: {
        ...serviceProduct.product,
        quantity: Number(serviceProduct.product.quantity)
      },
      suggestedQuantity: serviceProduct.suggestedQuantity
    }

    return NextResponse.json({
      success: true,
      data: formattedResponse,
      message: 'Product added to service suggestions'
    }, { status: 201 })

  } catch (error) {
    console.error('POST /api/services/[id]/products error:', error)
    
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

// DELETE /api/services/[id]/products - Remove a suggested product from a service
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // 1. Authenticate user (must be manager)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireManagerWithBusiness(user)

    const { id: serviceId } = await params
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')

    if (!productId) {
      return NextResponse.json(
        { 
          success: false,
          error: 'productId query parameter is required' 
        },
        { status: 400 }
      )
    }

    // 2. Verify service exists and belongs to business
    const service = await prisma.service.findFirst({
      where: {
        id: serviceId,
        businessId: authUser.businessId!
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

    // 3. Delete the suggested product
    const deleted = await prisma.serviceProduct.deleteMany({
      where: {
        serviceId: serviceId,
        productId: productId
      }
    })

    if (deleted.count === 0) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Suggested product not found' 
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Suggested product removed from service'
    })

  } catch (error) {
    console.error('DELETE /api/services/[id]/products error:', error)

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