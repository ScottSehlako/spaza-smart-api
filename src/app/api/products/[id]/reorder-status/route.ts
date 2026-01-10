import { NextRequest, NextResponse } from 'next/server'
import { checkReorderStatus, StockError } from '@/lib/stock'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// GET /api/products/[id]/reorder-status - Check if product needs reordering
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)
    
    // 2. Get product ID from params
    const { id: productId } = await params
    
    // 3. Verify product belongs to business
    const product = await prisma.product.findUnique({
      where: { 
        id: productId,
        businessId: authUser.businessId!
      },
      select: {
        id: true,
        businessId: true
      }
    })

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found in this business' },
        { status: 404 }
      )
    }

    // 4. Get reorder status using your stock engine
    const status = await checkReorderStatus(productId)

    // 5. Return response
    return NextResponse.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('GET /api/products/[id]/reorder-status error:', error)
    
    if (error instanceof StockError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
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