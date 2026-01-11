import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { salesReportQuerySchema } from '@/lib/validations/report'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// GET /api/reports/sales - Sales reports
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user (Manager or Accountant only)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)
    
    // Only managers and accountants can access reports
    if (!['MANAGER', 'ACCOUNTANT'].includes(authUser.role)) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Only managers and accountants can access reports' 
        },
        { status: 403 }
      )
    }

    // 2. Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams
    
    const queryInput: Record<string, any> = {
      groupBy: searchParams.get('groupBy') || 'day',
      includeServices: searchParams.get('includeServices') || 'true',
      includeProducts: searchParams.get('includeProducts') || 'true',
      format: searchParams.get('format') || 'json'
    }

    // Date filters
    const optionalDateFields = ['startDate', 'endDate']
    optionalDateFields.forEach(field => {
      const value = searchParams.get(field)
      if (value !== null) {
        queryInput[field] = value
      }
    })

    const query = salesReportQuerySchema.parse(queryInput)

    const { 
      startDate, endDate, groupBy, 
      includeServices, includeProducts, format 
    } = query

    // 3. Build date range filter
    const dateFilter: any = {}
    if (startDate) {
      dateFilter.gte = new Date(startDate)
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate)
    }

    // 4. Fetch product sales data
    const productSales = await prisma.sale.findMany({
      where: {
        businessId: authUser.businessId!,
        status: 'COMPLETED',
        createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
      },
      include: {
        saleItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                costPerUnit: true,
                sellingPrice: true
              }
            }
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // 5. Fetch service sales data if requested
    let serviceSales: any[] = []
    if (includeServices) {
      serviceSales = await prisma.serviceSale.findMany({
        where: {
          businessId: authUser.businessId!,
          createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              basePrice: true
            }
          },
          productUsages: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  costPerUnit: true
                }
              }
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    }

    // 6. Process and group data based on groupBy parameter
    let groupedData: any = {}
    const allSales = [...productSales, ...serviceSales]

    allSales.forEach(sale => {
      const saleDate = new Date(sale.createdAt)
      let groupKey: string

      switch (groupBy) {
        case 'day':
          groupKey = saleDate.toISOString().split('T')[0] // YYYY-MM-DD
          break
        case 'week':
          const weekNumber = Math.ceil(saleDate.getDate() / 7)
          groupKey = `${saleDate.getFullYear()}-W${weekNumber}`
          break
        case 'month':
          groupKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`
          break
        case 'product':
          if ('product' in sale) {
            groupKey = sale.product.name
          } else {
            groupKey = 'service'
          }
          break
        case 'employee':
          groupKey = sale.createdBy.name
          break
        default:
          groupKey = saleDate.toISOString().split('T')[0]
      }

      if (!groupedData[groupKey]) {
        groupedData[groupKey] = {
          totalAmount: 0,
          totalCost: 0,
          totalProfit: 0,
          count: 0,
          items: []
        }
      }

      // Calculate sale details
      let saleAmount = 0
      let saleCost = 0

      if ('totalAmount' in sale) {
        // Product sale
        saleAmount = sale.totalAmount
        sale.saleItems.forEach((item: any) => {
          saleCost += item.quantity * item.product.costPerUnit
        })
      } else {
        // Service sale
        saleAmount = sale.service.basePrice
        sale.productUsages.forEach((usage: any) => {
          saleCost += usage.quantityUsed * usage.product.costPerUnit
        })
      }

      const saleProfit = saleAmount - saleCost

      groupedData[groupKey].totalAmount += saleAmount
      groupedData[groupKey].totalCost += saleCost
      groupedData[groupKey].totalProfit += saleProfit
      groupedData[groupKey].count += 1
      groupedData[groupKey].items.push({
        id: sale.id,
        type: 'totalAmount' in sale ? 'product' : 'service',
        amount: saleAmount,
        cost: saleCost,
        profit: saleProfit,
        date: sale.createdAt,
        employee: sale.createdBy.name
      })
    })

    // 7. Calculate totals
    const totals = {
      totalAmount: Object.values(groupedData).reduce((sum: number, group: any) => sum + group.totalAmount, 0),
      totalCost: Object.values(groupedData).reduce((sum: number, group: any) => sum + group.totalCost, 0),
      totalProfit: Object.values(groupedData).reduce((sum: number, group: any) => sum + group.totalProfit, 0),
      totalCount: Object.values(groupedData).reduce((sum: number, group: any) => sum + group.count, 0)
    }

    // 8. Format response based on requested format
    if (format === 'csv') {
      // Convert to CSV
      const csvRows = []
      // Header
      csvRows.push(['Date/Group', 'Total Sales', 'Total Cost', 'Total Profit', 'Transaction Count'])
      
      // Data rows
      Object.entries(groupedData).forEach(([group, data]: [string, any]) => {
        csvRows.push([
          group,
          data.totalAmount.toFixed(2),
          data.totalCost.toFixed(2),
          data.totalProfit.toFixed(2),
          data.count.toString()
        ])
      })
      
      // Totals row
      csvRows.push([
        'TOTAL',
        totals.totalAmount.toFixed(2),
        totals.totalCost.toFixed(2),
        totals.totalProfit.toFixed(2),
        totals.totalCount.toString()
      ])

      const csvContent = csvRows.map(row => row.join(',')).join('\n')
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="sales-report-${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    // 9. Return JSON response (default)
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          period: {
            startDate: startDate || 'all',
            endDate: endDate || 'all'
          },
          grouping: groupBy,
          totals
        },
        groupedData,
        productSales: includeProducts ? productSales.map(sale => ({
          id: sale.id,
          type: 'product',
          receiptNumber: sale.receiptNumber,
          customerName: sale.customerName,
          totalAmount: sale.totalAmount,
          date: sale.createdAt,
          items: sale.saleItems.map(item => ({
            product: item.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice
          }))
        })) : [],
        serviceSales: includeServices ? serviceSales.map(sale => ({
            id: sale.id,
            type: 'service',
            service: sale.service.name,
            basePrice: sale.service.basePrice,
            date: sale.createdAt,
            productUsage: sale.productUsages.map((usage: any) => ({
              product: usage.product.name,
              quantityUsed: usage.quantityUsed,
              costPerUnit: usage.product.costPerUnit
            }))
          })) : []
      },
      message: 'Sales report generated successfully'
    })

  } catch (error) {
    console.error('GET /api/reports/sales error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Invalid query parameters', 
          details: error.issues 
        },
        { status: 400 }
      )
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { 
          success: false,
          error: error.message 
        },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error' 
      },
      { status: 500 }
    )
  }
}