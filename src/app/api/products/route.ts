// src/app/api/products/route.ts - FOR LISTING PRODUCTS
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { productQuerySchema } from '@/lib/validations/product'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    // 2. Parse and validate query parameters - FIXED VERSION
    const searchParams = request.nextUrl.searchParams

    // Create a clean query object with defaults
    const queryInput: Record<string, any> = {
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50'
    }

    // Only add optional fields if they exist
    const optionalFields = ['search', 'lowStockOnly', 'isActive', 'unitOfMeasure']
    optionalFields.forEach(field => {
      const value = searchParams.get(field)
      if (value !== null) {
        queryInput[field] = value
      }
    })

    // Now validate
    const query = productQuerySchema.parse(queryInput)

    const { page, limit, search, lowStockOnly, isActive, unitOfMeasure } = query
    const skip = (page - 1) * limit

    // 3. Build where clause
    const where: any = {
      businessId: authUser.businessId!
    }

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    }

    // Low stock filter
    if (lowStockOnly) {
      where.reorderThreshold = { not: null }
      where.quantity = { lte: prisma.product.fields.reorderThreshold }
    }

    // Active/inactive filter
    if (isActive !== undefined) {
      where.isActive = isActive
    }

    // Unit of measure filter
    if (unitOfMeasure) {
      where.unitOfMeasure = unitOfMeasure
    }

    // 4. Fetch products with pagination
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          sku: true,
          unitOfMeasure: true,
          quantity: true,
          reorderThreshold: true,
          optimalQuantity: true,
          costPerUnit: true,
          sellingPrice: true,
          isConsumable: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          barcode: {
            select: {
              code: true
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true
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
      prisma.product.count({ where })
    ])

    // 5. Format response for mobile
    const formattedProducts = products.map(product => ({
      ...product,
      barcode: product.barcode?.code || null,
      createdBy: product.createdBy.name,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString()
    }))

    // 6. Return response
    return NextResponse.json({
      success: true,
      data: formattedProducts,
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
    console.error('GET /api/products error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.issues },
        { status: 400 }
      )
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}