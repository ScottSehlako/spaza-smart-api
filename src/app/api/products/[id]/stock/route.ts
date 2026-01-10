import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { 
  addStock, 
  adjustStock, 
  getProductStockHistory,
  StockError 
} from '@/lib/stock'
import { getCurrentUserFromRequest, requireManagerWithBusiness, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// Validation schemas
const addStockSchema = z.object({
  quantity: z.number().positive('Quantity must be greater than 0'),
  notes: z.string().optional()
})

const adjustStockSchema = z.object({
  quantity: z.number().refine(val => val !== 0, { message: 'Quantity cannot be zero' }),
  reason: z.string().min(1, 'Reason is required for stock adjustment')
})

// GET /api/products/[id]/stock - Get stock history
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
    
    // 3. Get query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const type = searchParams.get('type') as any
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // 4. Fetch stock history
    const history = await getProductStockHistory(
      productId,
      authUser.businessId!,
      {
        page,
        limit,
        type,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined
      }
    )

    return NextResponse.json(history)
    
  } catch (error) {
    console.error('GET /api/products/[id]/stock error:', error)
    
    if (error instanceof StockError) {
      return NextResponse.json(
        { error: error.message },
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

// POST /api/products/[id]/stock - Add stock (purchase)
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
    const { quantity, notes } = addStockSchema.parse(body)

    // 4. Add stock using your stock engine
    const result = await addStock(
      productId,
      manager.businessId!,
      manager.id,
      quantity,
      notes
    )

    // 5. Return success response
    return NextResponse.json({
      success: true,
      message: 'Stock added successfully',
      data: result
    }, { status: 201 })
    
  } catch (error) {
    console.error('POST /api/products/[id]/stock error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.issues },
        { status: 400 }
      )
    }
    
    if (error instanceof StockError) {
      return NextResponse.json(
        { error: error.message },
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
      { error: 'Failed to add stock' },
      { status: 500 }
    )
  }
}

// PATCH /api/products/[id]/stock - Adjust stock (manual correction)
export async function PATCH(
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
    const { quantity, reason } = adjustStockSchema.parse(body)

    // 4. Adjust stock using your stock engine
    const result = await adjustStock(
      productId,
      manager.businessId!,
      manager.id,
      quantity,
      reason
    )

    // 5. Return success response
    return NextResponse.json({
      success: true,
      message: 'Stock adjusted successfully',
      data: result
    })
    
  } catch (error) {
    console.error('PATCH /api/products/[id]/stock error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.issues },
        { status: 400 }
      )
    }
    
    if (error instanceof StockError) {
      return NextResponse.json(
        { error: error.message },
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
      { error: 'Failed to adjust stock' },
      { status: 500 }
    )
  }
}