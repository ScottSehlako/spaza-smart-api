import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sellProduct, StockError } from '@/lib/stock'
import { createSaleSchema } from '@/lib/validations/sale'
import { getCurrentUserFromRequest, requireBusinessAccess, requireManagerWithBusiness, AuthError } from '@/lib/api-auth'

// POST /api/sales/product - Create a product sale
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user (employees and managers can sell)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    // 2. Validate request body
    const body = await request.json()
    const { items, customerName, customerPhone, notes } = createSaleSchema.parse(body)

    // 3. Use transaction for sale creation
    const result = await prisma.$transaction(async (tx) => {
      // Generate receipt number (you can customize this)
      const receiptNumber = `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`

      // Create sale record
      const sale = await tx.sale.create({
        data: {
          receiptNumber,
          totalAmount: 0, // Will be calculated
          businessId: authUser.businessId!,
          createdById: authUser.id,
          customerName,
          customerPhone,
          status: 'COMPLETED'
        },
        select: {
          id: true,
          receiptNumber: true,
          createdAt: true
        }
      })

      let totalAmount = 0
      const saleItems = []
      const stockMovements = []

      // Process each sale item
      for (const item of items) {
        // Get product details with lock
        const product = await tx.product.findUnique({
          where: { 
            id: item.productId,
            businessId: authUser.businessId!,
            isActive: true
          },
          select: {
            id: true,
            name: true,
            sellingPrice: true,
            quantity: true,
            costPerUnit: true
          }
        })

        if (!product) {
          throw new StockError(`Product not found or inactive: ${item.productId}`)
        }

        // Check stock availability
        if (product.quantity < item.quantity) {
          throw new StockError(
            `Insufficient stock for ${product.name}. Available: ${product.quantity}, Requested: ${item.quantity}`
          )
        }

        // Calculate item total (use provided unitPrice or product's sellingPrice)
        const unitPrice = item.unitPrice || product.sellingPrice
        const itemTotal = unitPrice * item.quantity
        const itemCost = product.costPerUnit * item.quantity
        const itemProfit = itemTotal - itemCost

        // Create sale item
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice,
            totalPrice: itemTotal
          },
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true
          }
        })

        // Sell product using your stock engine
        const stockResult = await sellProduct(
          item.productId,
          authUser.businessId!,
          authUser.id,
          item.quantity,
          sale.id,
          `Sale: ${sale.receiptNumber} - ${product.name}`
        )

        // Link stock movement to sale item
        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: { stockMovementId: stockResult.stockMovement.id }
        })

        totalAmount += itemTotal
        saleItems.push({
          ...saleItem,
          productName: product.name,
          cost: itemCost,
          profit: itemProfit
        })
        stockMovements.push(stockResult.stockMovement)
      }

      // Update sale total
      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: { totalAmount },
        select: {
          id: true,
          receiptNumber: true,
          totalAmount: true,
          customerName: true,
          customerPhone: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      })

   // Create audit log
await tx.auditLog.create({
  data: {
    action: 'SALE_CREATED',
    entityType: 'Sale',
    entityId: sale.id,
    businessId: authUser.businessId!,
    performedById: authUser.id,
    newValue: {
      receiptNumber: sale.receiptNumber,
      totalAmount,
      itemCount: saleItems.length,           // CHANGED: items → itemCount
      customerName,
      customerPhone,
      items: saleItems.map(item => ({        // Keep this as 'items'
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice
      }))
    },
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
  }
})

      return {
        sale: updatedSale,
        items: saleItems,
        stockMovements,
        totals: {
          amount: totalAmount,
          items: saleItems.length,
          profit: saleItems.reduce((sum, item) => sum + item.profit, 0)
        }
      }
    })

    // 4. Return success response
    return NextResponse.json({
      success: true,
      message: 'Sale completed successfully',
      data: result
    }, { status: 201 })

  } catch (error) {
    console.error('POST /api/sales/product error:', error)
    
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
      { error: 'Failed to create sale' },
      { status: 500 }
    )
  }
}

// GET /api/sales/product - Get sales history
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user (only managers can view sales)
    const user = await getCurrentUserFromRequest(request)
    const manager = requireManagerWithBusiness(user)

    // 2. Parse query parameters
    const searchParams = request.nextUrl.searchParams
    
    // Build query object
    const queryData: any = {
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '50'
    }
    
    // Add optional parameters
    const startDate = searchParams.get('startDate')
    if (startDate) queryData.startDate = startDate
    
    const endDate = searchParams.get('endDate')
    if (endDate) queryData.endDate = endDate
    
    const search = searchParams.get('search')
    if (search) queryData.search = search

    // 3. Build where clause
    const where: any = {
      businessId: manager.businessId!
    }

    // Date filtering
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate)
      if (endDate) where.createdAt.lte = new Date(endDate)
    }

    // Search filtering (by receipt number or customer name)
    if (search) {
      where.OR = [
        { receiptNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } }
      ]
    }

    const page = parseInt(queryData.page)
    const limit = parseInt(queryData.limit)
    const skip = (page - 1) * limit

    // 4. Fetch sales with pagination
    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
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
                  sku: true
                }
              },
              stockMovement: {
                select: {
                  id: true,
                  type: true,
                  quantity: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.sale.count({ where })
    ])

    // 5. Calculate totals
    const totals = await prisma.sale.aggregate({
      where,
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    })

    // 6. Format response
    const formattedSales = sales.map(sale => ({
      ...sale,
      createdAt: sale.createdAt.toISOString(),
      updatedAt: sale.updatedAt.toISOString(),
      saleItems: sale.saleItems.map(item => ({
        ...item,
        product: item.product.name
      }))
    }))

    // 7. Return response
    return NextResponse.json({
      success: true,
      data: {
        sales: formattedSales,
        totals: {
          amount: totals._sum.totalAmount || 0,
          count: totals._count.id
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1
        }
      }
    })

  } catch (error) {
    console.error('GET /api/sales/product error:', error)
    
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