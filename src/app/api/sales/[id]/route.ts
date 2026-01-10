import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUserFromRequest, requireBusinessAccess, requireManagerWithBusiness, AuthError } from '@/lib/api-auth'

// GET /api/sales/[id] - Get single sale with details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)
    
    // 2. Get sale ID from params
    const { id: saleId } = await params

    // 3. Fetch sale with all details
    const sale = await prisma.sale.findUnique({
      where: { 
        id: saleId,
        businessId: authUser.businessId!
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        saleItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unitOfMeasure: true,
                costPerUnit: true,
                sellingPrice: true
              }
            },
            stockMovement: {
              select: {
                id: true,
                type: true,
                quantity: true,
                previousQuantity: true,
                newQuantity: true,
                notes: true,
                createdAt: true
              }
            }
          }
        }
      }
    })

    if (!sale) {
      return NextResponse.json(
        { error: 'Sale not found' },
        { status: 404 }
      )
    }

    // 4. Calculate profit and cost details
    let totalCost = 0
    const itemsWithProfit = sale.saleItems.map(item => {
      const itemCost = item.product.costPerUnit * item.quantity
      const itemProfit = item.totalPrice - itemCost
      totalCost += itemCost
      
      return {
        ...item,
        product: item.product.name,
        cost: itemCost,
        profit: itemProfit,
        profitMargin: (itemProfit / item.totalPrice) * 100
      }
    })

    const totalProfit = sale.totalAmount - totalCost
    const profitMargin = (totalProfit / sale.totalAmount) * 100

    // 5. Format response
    const response = {
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      saleItems: itemsWithProfit,
      financials: {
        totalAmount: sale.totalAmount,
        totalCost,
        totalProfit,
        profitMargin,
        items: sale.saleItems.length
      }
    }

    // 6. Return response
    return NextResponse.json({
      success: true,
      data: response
    })

  } catch (error) {
    console.error('GET /api/sales/[id] error:', error)
    
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