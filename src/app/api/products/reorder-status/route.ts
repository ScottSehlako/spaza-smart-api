import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'
import { checkReorderStatus, StockError } from '@/lib/stock'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(
    req,
    async (context) => {
      const productId = params.id

      try {
        const status = await checkReorderStatus(productId)
        
        // Verify product belongs to business
        const { prisma } = await import('@/lib/prisma')
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { businessId: true }
        })

        if (!product || product.businessId !== context.businessId) {
          return NextResponse.json(
            { error: 'Product not found in this business' },
            { status: 404 }
          )
        }

        return NextResponse.json(status)
      } catch (error) {
        if (error instanceof StockError) {
          return NextResponse.json(
            { error: error.message },
            { status: 404 }
          )
        }
        throw error
      }
    },
    {
      requiredRoles: ['MANAGER', 'EMPLOYEE'],
      requireBusiness: true
    }
  )
}