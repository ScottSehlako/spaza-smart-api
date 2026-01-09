import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'
import { prisma } from '@/lib/prisma'
import { sellProduct, StockError } from '@/lib/stock'

// POST: Create a product sale
export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (context) => {
      const { items, customerName, customerPhone } = await req.json()

      // Validate input
      if (!items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { error: 'Sale items are required' },
          { status: 400 }
        )
      }

      // Validate each item
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity <= 0) {
          return NextResponse.json(
            { error: 'Each item must have productId and quantity > 0' },
            { status: 400 }
          )
        }
      }

      // Use transaction for sale creation
      return await prisma.$transaction(async (tx) => {
        // Create sale record
        const sale = await tx.sale.create({
          data: {
            totalAmount: 0, // Will be calculated
            businessId: context.businessId!,
            createdById: context.userId,
            customerName,
            customerPhone,
            status: 'COMPLETED'
          }
        })

        let totalAmount = 0
        const saleItems = []
        const stockMovements = []

        // Process each sale item
        for (const item of items) {
          // Get product details
          const product = await tx.product.findUnique({
            where: { 
              id: item.productId,
              businessId: context.businessId 
            },
            select: {
              id: true,
              sellingPrice: true,
              name: true,
              quantity: true
            }
          })

          if (!product) {
            throw new StockError(`Product ${item.productId} not found`)
          }

          // Calculate item total
          const unitPrice = product.sellingPrice
          const itemTotal = unitPrice * item.quantity

          // Create sale item
          const saleItem = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice,
              totalPrice: itemTotal
            }
          })

          // Update stock
          const stockResult = await sellProduct(
            item.productId,
            context.businessId!,
            context.userId,
            item.quantity,
            sale.id,
            `Sale: ${sale.receiptNumber}`
          )

          // Link stock movement to sale item
          await tx.saleItem.update({
            where: { id: saleItem.id },
            data: { stockMovementId: stockResult.stockMovement.id }
          })

          totalAmount += itemTotal
          saleItems.push(saleItem)
          stockMovements.push(stockResult)
        }

        // Update sale total
        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: { totalAmount }
        })

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: 'CREATE_SALE',
            entityType: 'Sale',
            entityId: sale.id,
            businessId: context.businessId,
            performedById: context.userId,
            newValue: {
              receiptNumber: sale.receiptNumber,
              totalAmount,
              items: saleItems.length,
              customerName,
              customerPhone
            },
            ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
            userAgent: req.headers.get('user-agent') || 'unknown',
          }
        })

        return NextResponse.json({
          success: true,
          message: 'Sale completed successfully',
          data: {
            sale: updatedSale,
            items: saleItems,
            stockMovements
          }
        }, { status: 201 })
      })
    },
    {
      requiredRoles: ['MANAGER', 'EMPLOYEE'],
      requireBusiness: true
    }
  )
}

// GET: Get sales history
export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (context) => {
      const { searchParams } = new URL(req.url)
      const page = parseInt(searchParams.get('page') || '1')
      const limit = parseInt(searchParams.get('limit') || '50')
      const startDate = searchParams.get('startDate')
      const endDate = searchParams.get('endDate')

      const skip = (page - 1) * limit

      const where: any = {
        businessId: context.businessId
      }

      if (startDate || endDate) {
        where.createdAt = {}
        if (startDate) where.createdAt.gte = new Date(startDate)
        if (endDate) where.createdAt.lte = new Date(endDate)
      }

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

      // Calculate totals
      const totals = await prisma.sale.aggregate({
        where,
        _sum: {
          totalAmount: true
        },
        _count: {
          id: true
        }
      })

      return NextResponse.json({
        sales,
        totals: {
          amount: totals._sum.totalAmount || 0,
          count: totals._count.id
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      })
    },
    {
      requiredRoles: ['MANAGER'],
      requireBusiness: true
    }
  )
}