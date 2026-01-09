// src/app/api/products/create/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createProductSchema } from '@/lib/validations/product'
import { 
  getCurrentUserFromRequest, 
  requireManagerWithBusiness,
  AuthError
} from '../../../../lib/api-auth'

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate and authorize user
    const user = await getCurrentUserFromRequest(request)
    const manager = requireManagerWithBusiness(user)

    // 2. Parse and validate request body
    const body = await request.json()
    const validatedData = createProductSchema.parse(body)

    // 3. Validate business logic
    if (validatedData.sellingPrice <= validatedData.costPerUnit) {
      return NextResponse.json(
        { error: 'Selling price must be greater than cost price' },
        { status: 400 }
      )
    }

    // 4. Check if barcode already exists (if provided)
    if (validatedData.barcode) {
      const existingBarcode = await prisma.barcode.findUnique({
        where: { code: validatedData.barcode }
      })

      if (existingBarcode) {
        return NextResponse.json(
          { error: 'Barcode already registered to another product' },
          { status: 400 }
        )
      }
    }

    // 5. Check if product with same name already exists in this business
    const existingProduct = await prisma.product.findFirst({
      where: {
        name: validatedData.name,
        businessId: manager.businessId!
      }
    })

    if (existingProduct) {
      return NextResponse.json(
        { error: 'Product with this name already exists in your business' },
        { status: 400 }
      )
    }

    // 6. Create product with transaction (for barcode if provided)
    const result = await prisma.$transaction(async (tx) => {
      // Create the product
      const product = await tx.product.create({
        data: {
          name: validatedData.name,
          description: validatedData.description,
          sku: validatedData.sku,
          unitOfMeasure: validatedData.unitOfMeasure,
          costPerUnit: validatedData.costPerUnit,
          sellingPrice: validatedData.sellingPrice,
          reorderThreshold: validatedData.reorderThreshold,
          optimalQuantity: validatedData.optimalQuantity,
          isConsumable: validatedData.isConsumable,
          isActive: true,
          businessId: manager.businessId!,
          createdById: manager.id
        },
        select: {
          id: true,
          name: true,
          sku: true,
          unitOfMeasure: true,
          quantity: true,
          costPerUnit: true,
          sellingPrice: true,
          isConsumable: true,
          isActive: true,
          createdAt: true
        }
      })

      // Create barcode if provided
      let barcode = null
      if (validatedData.barcode) {
        barcode = await tx.barcode.create({
          data: {
            code: validatedData.barcode,
            productId: product.id,
            businessId: manager.businessId!
          }
        })
      }

      // Create audit log - Convert product to plain object for JSON storage
      const productForAudit = {
        ...product,
        createdAt: product.createdAt.toISOString()
      }

      const ipAddress = request.headers.get('x-forwarded-for') || 
                       request.headers.get('x-real-ip') || 
                       'unknown'

      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_CREATED',
          entityType: 'Product',
          entityId: product.id,
          businessId: manager.businessId!,
          performedById: manager.id,
          newValue: productForAudit,
          ipAddress,
          userAgent: request.headers.get('user-agent') || 'unknown'
        }
      })

      return { product, barcode: barcode?.code || null }
    })

    // 7. Return success response
    return NextResponse.json({
      success: true,
      message: 'Product created successfully',
      data: {
        ...result.product,
        barcode: result.barcode,
        createdAt: result.product.createdAt.toISOString()
      }
    }, { status: 201 })

  } catch (error) {
    console.error('POST /api/products/create error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.issues },
        { status: 400 }
      )
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 401 }
      )
    }

    // Handle Prisma unique constraint errors
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Product with this SKU or name already exists' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create product' },
      { status: 500 }
    )
  }
}