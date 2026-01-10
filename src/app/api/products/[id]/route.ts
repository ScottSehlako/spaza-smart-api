// src/app/api/products/[id]/route.ts - FIXED VERSION
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { updateProductSchema } from '@/lib/validations/product'
import { getCurrentUserFromRequest, requireManagerWithBusiness, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// Params schema for validation
const paramsSchema = z.object({
  id: z.string().cuid('Invalid product ID format')
})

// Helper to convert objects to JSON-serializable format
function toJsonValue(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(toJsonValue)
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, toJsonValue(value)])
    )
  }
  return obj
}

// GET /api/products/[id] - Get single product
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }  // FIXED: params is Promise
  ) {
    try {
      // 1. Authenticate user
      const user = await getCurrentUserFromRequest(request)
      const authUser = requireBusinessAccess(user)
  
      // 2. Get and validate product ID - FIXED
      const { id: productId } = await params  // AWAIT the Promise
      const { id } = paramsSchema.parse({ id: productId })
  
      // 3. Fetch product with detailed information
      const product = await prisma.product.findUnique({
        where: { 
          id: productId,
          businessId: authUser.businessId! // Ensure business scoping
        },
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
          },
          // Include recent stock movements (last 10)
          stockMovements: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              type: true,
              quantity: true,
              previousQuantity: true,
              newQuantity: true,
              notes: true,
              createdAt: true,
              createdBy: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      })
  
      if (!product) {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        )
      }
  
      // 4. Format response
      const formattedProduct = {
        ...product,
        barcode: product.barcode?.code || null,
        createdBy: product.createdBy.name,
        stockMovements: product.stockMovements.map(movement => ({
          ...movement,
          createdBy: movement.createdBy.name,
          createdAt: movement.createdAt.toISOString()
        })),
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString()
      }
  
      // 5. Return response
      return NextResponse.json({
        success: true,
        data: formattedProduct
      })
  
    } catch (error) {
      console.error('GET /api/products/[id] error:', error)
      
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid product ID', details: error.issues },
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

// PATCH /api/products/[id] - Update product
// PATCH /api/products/[id] - Update product
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }  // FIXED
  ) {
    try {
      // 1. Authenticate and authorize
      const user = await getCurrentUserFromRequest(request)
      const manager = requireManagerWithBusiness(user)
  
      // 2. Get and validate product ID - FIXED
      const { id: productId } = await params  // AWAIT
      const { id } = paramsSchema.parse({ id: productId })
      // ... rest of PATCH code

    // 3. Parse and validate request body
    const body = await request.json()
    const updateData = updateProductSchema.parse(body)

    // 4. Validate business logic
    if (updateData.sellingPrice !== undefined && 
        updateData.costPerUnit !== undefined &&
        updateData.sellingPrice <= updateData.costPerUnit) {
      return NextResponse.json(
        { error: 'Selling price must be greater than cost price' },
        { status: 400 }
      )
    }

    // 5. Check if product exists and belongs to business
    const existingProduct = await prisma.product.findUnique({
      where: { 
        id: productId,
        businessId: manager.businessId!
      },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        costPerUnit: true,
        isActive: true
      }
    })

    if (!existingProduct) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

    // 6. Check for name/SKU conflicts if being updated
    if (updateData.name || updateData.sku) {
      const whereClause: any = {
        businessId: manager.businessId!,
        id: { not: productId } // Exclude current product
      }

      if (updateData.name) {
        whereClause.name = updateData.name
      }
      if (updateData.sku) {
        whereClause.sku = updateData.sku
      }

      const conflict = await prisma.product.findFirst({
        where: whereClause
      })

      if (conflict) {
        return NextResponse.json(
          { error: 'Product with this name or SKU already exists' },
          { status: 400 }
        )
      }
    }

    // 7. Update product with transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get old values for audit log (convert to serializable format)
      const oldProductRaw = await tx.product.findUnique({
        where: { id: productId },
        select: {
          name: true,
          sku: true,
          sellingPrice: true,
          costPerUnit: true,
          reorderThreshold: true,
          isActive: true
        }
      })

      // Convert to JSON-serializable format
      const oldProduct = oldProductRaw ? toJsonValue(oldProductRaw) : null

      // Build update data
      const updatePayload: any = {
        ...updateData,
        updatedAt: new Date()
      }

      // Handle barcode update if provided
      if (updateData.barcode !== undefined) {
        if (updateData.barcode) {
          // Upsert barcode (create or update)
          updatePayload.barcode = {
            upsert: {
              create: {
                code: updateData.barcode,
                businessId: manager.businessId!
              },
              update: {
                code: updateData.barcode
              }
            }
          }
        } else {
          // If barcode is empty string, delete it
          updatePayload.barcode = { delete: true }
        }
      }

      // Update the product
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: updatePayload,
        select: {
          id: true,
          name: true,
          sku: true,
          unitOfMeasure: true,
          quantity: true,
          costPerUnit: true,
          sellingPrice: true,
          reorderThreshold: true,
          optimalQuantity: true,
          isConsumable: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          barcode: {
            select: { code: true }
          }
        }
      })

      // Convert to JSON-serializable format for audit log
      const newProduct = toJsonValue(updatedProduct)

      // Create audit log if anything actually changed
      if (Object.keys(updateData).length > 0) {
        const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
        
        await tx.auditLog.create({
          data: {
            action: 'PRODUCT_UPDATED',
            entityType: 'Product',
            entityId: productId,
            businessId: manager.businessId!,
            performedById: manager.id,
            oldValue: oldProduct,
            newValue: newProduct,
            ipAddress,
            userAgent: request.headers.get('user-agent') || 'unknown'
          }
        })
      }

      return updatedProduct
    })

    // 8. Return success response
    return NextResponse.json({
      success: true,
      message: 'Product updated successfully',
      data: {
        ...result,
        barcode: result.barcode?.code || null,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString()
      }
    })

  } catch (error) {
    console.error('PATCH /api/products/[id] error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.issues },
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
      { error: 'Failed to update product' },
      { status: 500 }
    )
  }
}

// DELETE /api/products/[id] - Soft delete product
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }  // FIXED
  ) {
    try {
      // 1. Authenticate and authorize
      const user = await getCurrentUserFromRequest(request)
      const manager = requireManagerWithBusiness(user)
  
      // 2. Get and validate product ID - FIXED
      const { id: productId } = await params  // AWAIT
      const { id } = paramsSchema.parse({ id: productId })
      // ... rest of DELETE code

    // 3. Check if product exists and belongs to business
    const product = await prisma.product.findUnique({
      where: { 
        id: productId,
        businessId: manager.businessId!
      },
      select: {
        id: true,
        name: true,
        quantity: true,
        isActive: true
      }
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      )
    }

    // 4. Prevent deletion if product has stock
    if (product.quantity > 0) {
      return NextResponse.json(
        { 
          error: 'Cannot delete product with stock remaining',
          currentStock: product.quantity
        },
        { status: 400 }
      )
    }

    // 5. Check if product is already inactive
    if (!product.isActive) {
      return NextResponse.json(
        { error: 'Product is already inactive' },
        { status: 400 }
      )
    }

    // 6. Soft delete with transaction
    await prisma.$transaction(async (tx) => {
      // Soft delete by setting isActive to false
      await tx.product.update({
        where: { id: productId },
        data: { 
          isActive: false,
          updatedAt: new Date()
        }
      })

      // Create audit log
      const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
      
      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_DELETED',
          entityType: 'Product',
          entityId: productId,
          businessId: manager.businessId!,
          performedById: manager.id,
          oldValue: toJsonValue({ isActive: true }),
          newValue: toJsonValue({ isActive: false }),
          ipAddress,
          userAgent: request.headers.get('user-agent') || 'unknown'
        }
      })
    })

    // 7. Return success response
    return NextResponse.json({
      success: true,
      message: 'Product deactivated successfully'
    })

  } catch (error) {
    console.error('DELETE /api/products/[id] error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid product ID', details: error.issues },
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
      { error: 'Failed to delete product' },
      { status: 500 }
    )
  }
}