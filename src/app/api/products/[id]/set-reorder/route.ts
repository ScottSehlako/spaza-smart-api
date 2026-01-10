import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth'

// Validation schema
const setReorderSchema = z.object({
  reorderThreshold: z.number().nonnegative('Reorder threshold cannot be negative').optional(),
  optimalQuantity: z.number().positive('Optimal quantity must be positive').optional()
}).refine(
  data => data.reorderThreshold !== undefined || data.optimalQuantity !== undefined,
  {
    message: 'At least one of reorderThreshold or optimalQuantity must be provided'
  }
)

// POST /api/products/[id]/set-reorder - Set reorder levels
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Authenticate and authorize (only managers)
    const user = await getCurrentUserFromRequest(request)
    const manager = requireManagerWithBusiness(user)
    
    // 2. Get product ID from params
    const { id: productId } = await params
    
    // 3. Validate request body
    const body = await request.json()
    const updateData = setReorderSchema.parse(body)

    // 4. Verify product exists and belongs to business
    const product = await prisma.product.findUnique({
      where: { 
        id: productId,
        businessId: manager.businessId!
      },
      select: {
        id: true,
        name: true,
        reorderThreshold: true,
        optimalQuantity: true,
        quantity: true
      }
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found in this business' },
        { status: 404 }
      )
    }

    // 5. Validate business logic
    if (updateData.reorderThreshold !== undefined && updateData.optimalQuantity !== undefined) {
      if (updateData.reorderThreshold >= updateData.optimalQuantity) {
        return NextResponse.json(
          { error: 'Reorder threshold must be less than optimal quantity' },
          { status: 400 }
        )
      }
    }

    // 6. Update product with transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get old values for audit
      const oldValues = {
        reorderThreshold: product.reorderThreshold,
        optimalQuantity: product.optimalQuantity
      }

      // Update the product
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          reorderThreshold: updateData.reorderThreshold,
          optimalQuantity: updateData.optimalQuantity,
          updatedAt: new Date()
        },
        select: {
          id: true,
          name: true,
          quantity: true,
          reorderThreshold: true,
          optimalQuantity: true,
          isActive: true,
          updatedAt: true
        }
      })

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'PRODUCT_REORDER_SET',
          entityType: 'Product',
          entityId: productId,
          businessId: manager.businessId!,
          performedById: manager.id,
          oldValue: oldValues,
          newValue: {
            reorderThreshold: updatedProduct.reorderThreshold,
            optimalQuantity: updatedProduct.optimalQuantity
          },
          ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
          userAgent: request.headers.get('user-agent') || 'unknown'
        }
      })

      return updatedProduct
    })

    // 7. Calculate reorder status
    const needsReorder = result.reorderThreshold !== null && 
                         result.quantity <= result.reorderThreshold
    const reorderAmount = result.optimalQuantity !== null
      ? Math.max(0, result.optimalQuantity - result.quantity)
      : 0

    // 8. Return success response
    return NextResponse.json({
      success: true,
      message: 'Reorder levels updated successfully',
      data: {
        product: {
          id: result.id,
          name: result.name,
          quantity: result.quantity,
          reorderThreshold: result.reorderThreshold,
          optimalQuantity: result.optimalQuantity,
          isActive: result.isActive,
          updatedAt: result.updatedAt.toISOString()
        },
        reorderStatus: {
          needsReorder,
          reorderAmount,
          status: needsReorder ? 'LOW_STOCK' : 'OK',
          message: needsReorder 
            ? `Product needs reorder. Current: ${result.quantity}, Threshold: ${result.reorderThreshold}`
            : 'Stock level is adequate'
        }
      }
    })
    
  } catch (error) {
    console.error('POST /api/products/[id]/set-reorder error:', error)
    
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
      { error: 'Failed to set reorder levels' },
      { status: 500 }
    )
  }
}