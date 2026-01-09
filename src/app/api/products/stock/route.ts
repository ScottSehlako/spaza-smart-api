import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'
import { 
  addStock, 
  adjustStock, 
  getProductStockHistory,
  StockError 
} from '@/lib/stock'

// GET: Get stock history for a product
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(
    req,
    async (context) => {
      const productId = params.id
      
      // Get query parameters
      const { searchParams } = new URL(req.url)
      const page = parseInt(searchParams.get('page') || '1')
      const limit = parseInt(searchParams.get('limit') || '50')
      const type = searchParams.get('type') as any
      const startDate = searchParams.get('startDate')
      const endDate = searchParams.get('endDate')

      const history = await getProductStockHistory(
        productId,
        context.businessId!,
        {
          page,
          limit,
          type,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined
        }
      )

      return NextResponse.json(history)
    },
    {
      requiredRoles: ['MANAGER', 'EMPLOYEE'],
      requireBusiness: true
    }
  )
}

// POST: Add stock (purchase)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(
    req,
    async (context) => {
      const productId = params.id
      const { quantity, notes } = await req.json()

      if (!quantity || quantity <= 0) {
        return NextResponse.json(
          { error: 'Valid quantity is required' },
          { status: 400 }
        )
      }

      try {
        const result = await addStock(
          productId,
          context.businessId!,
          context.userId,
          quantity,
          notes
        )

        return NextResponse.json({
          success: true,
          message: 'Stock added successfully',
          data: result
        })
      } catch (error) {
        if (error instanceof StockError) {
          return NextResponse.json(
            { error: error.message },
            { status: 400 }
          )
        }
        throw error
      }
    },
    {
      requiredRoles: ['MANAGER'],
      requireBusiness: true
    }
  )
}

// PATCH: Adjust stock (manual correction)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(
    req,
    async (context) => {
      const productId = params.id
      const { quantity, reason } = await req.json()

      if (!quantity || quantity === 0) {
        return NextResponse.json(
          { error: 'Valid quantity is required' },
          { status: 400 }
        )
      }

      if (!reason) {
        return NextResponse.json(
          { error: 'Reason is required for stock adjustment' },
          { status: 400 }
        )
      }

      try {
        const result = await adjustStock(
          productId,
          context.businessId!,
          context.userId,
          quantity,
          reason
        )

        return NextResponse.json({
          success: true,
          message: 'Stock adjusted successfully',
          data: result
        })
      } catch (error) {
        if (error instanceof StockError) {
          return NextResponse.json(
            { error: error.message },
            { status: 400 }
          )
        }
        throw error
      }
    },
    {
      requiredRoles: ['MANAGER'],
      requireBusiness: true
    }
  )
}