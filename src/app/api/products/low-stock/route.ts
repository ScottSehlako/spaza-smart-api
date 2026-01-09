import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (context) => {
      // Get products with low stock
      const lowStockProducts = await prisma.product.findMany({
        where: {
          businessId: context.businessId,
          isActive: true,
          reorderThreshold: { not: null },
          quantity: {
            lte: prisma.product.fields.reorderThreshold
          }
        },
        select: {
          id: true,
          name: true,
          sku: true,
          quantity: true,
          reorderThreshold: true,
          optimalQuantity: true,
          unitOfMeasure: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { quantity: 'asc' }
      })

      // Calculate reorder amounts
      const productsWithReorder = lowStockProducts.map(product => ({
        ...product,
        needsReorder: true,
        reorderAmount: product.optimalQuantity 
          ? Math.max(0, product.optimalQuantity - product.quantity)
          : product.reorderThreshold 
            ? product.reorderThreshold * 2 - product.quantity
            : 0
      }))

      return NextResponse.json({
        count: productsWithReorder.length,
        products: productsWithReorder,
        timestamp: new Date().toISOString()
      })
    },
    {
      requiredRoles: ['MANAGER'],
      requireBusiness: true
    }
  )
}