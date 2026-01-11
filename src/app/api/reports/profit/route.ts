import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { profitReportQuerySchema } from '@/lib/validations/report'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// GET /api/reports/profit - Profit analysis reports
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user (Manager or Accountant only)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)
    
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
      includeCosts: searchParams.get('includeCosts') || 'true',
      includeMargins: searchParams.get('includeMargins') || 'true',
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

    const query = profitReportQuerySchema.parse(queryInput)

    const { 
      startDate, endDate, groupBy, 
      includeCosts, includeMargins, format 
    } = query

    // 3. Build date range filter
    const dateFilter: any = {}
    if (startDate) {
      dateFilter.gte = new Date(startDate)
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate)
    }

    // 4. Fetch sales data with cost information
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
        }
      }
    })

    const serviceSales = await prisma.serviceSale.findMany({
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
        }
      }
    })

    // 5. Calculate profit for each sale
    const profitData = {
      productSales: productSales.map(sale => {
        const items = sale.saleItems.map(item => ({
          productId: item.product.id,
          productName: item.product.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitCost: item.product.costPerUnit,
          revenue: item.totalPrice,
          cost: item.quantity * item.product.costPerUnit,
          profit: item.totalPrice - (item.quantity * item.product.costPerUnit),
          profitMargin: ((item.totalPrice - (item.quantity * item.product.costPerUnit)) / item.totalPrice) * 100
        }))

        const totalRevenue = items.reduce((sum, item) => sum + item.revenue, 0)
        const totalCost = items.reduce((sum, item) => sum + item.cost, 0)
        const totalProfit = items.reduce((sum, item) => sum + item.profit, 0)
        const averageMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

        return {
          saleId: sale.id,
          date: sale.createdAt,
          type: 'product',
          items,
          totals: {
            revenue: totalRevenue,
            cost: totalCost,
            profit: totalProfit,
            profitMargin: averageMargin
          }
        }
      }),

      serviceSales: serviceSales.map(sale => {
        const serviceCost = sale.productUsages.reduce((sum, usage) => 
          sum + (usage.quantityUsed * usage.product.costPerUnit), 0
        )
        const serviceProfit = sale.service.basePrice - serviceCost
        const serviceMargin = sale.service.basePrice > 0 ? (serviceProfit / sale.service.basePrice) * 100 : 0

        return {
          saleId: sale.id,
          date: sale.createdAt,
          type: 'service',
          serviceName: sale.service.name,
          servicePrice: sale.service.basePrice,
          serviceCost,
          serviceProfit,
          serviceMargin,
          productUsage: sale.productUsages.map(usage => ({
            productName: usage.product.name,
            quantityUsed: usage.quantityUsed,
            unitCost: usage.product.costPerUnit,
            totalCost: usage.quantityUsed * usage.product.costPerUnit
          }))
        }
      })
    }

    // 6. Group data based on groupBy parameter
    let groupedProfit: any = {}

    // Process product sales
    profitData.productSales.forEach(sale => {
      const saleDate = new Date(sale.date)
      let groupKey: string

      switch (groupBy) {
        case 'day':
          groupKey = saleDate.toISOString().split('T')[0]
          break
        case 'week':
          const weekNumber = Math.ceil(saleDate.getDate() / 7)
          groupKey = `${saleDate.getFullYear()}-W${weekNumber}`
          break
        case 'month':
          groupKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`
          break
        case 'product':
          // Group by product
          sale.items.forEach(item => {
            const productKey = item.productName
            if (!groupedProfit[productKey]) {
              groupedProfit[productKey] = {
                type: 'product',
                totalRevenue: 0,
                totalCost: 0,
                totalProfit: 0,
                totalQuantity: 0,
                sales: []
              }
            }
            groupedProfit[productKey].totalRevenue += item.revenue
            groupedProfit[productKey].totalCost += item.cost
            groupedProfit[productKey].totalProfit += item.profit
            groupedProfit[productKey].totalQuantity += item.quantity
            groupedProfit[productKey].sales.push({
              saleId: sale.saleId,
              date: sale.date,
              quantity: item.quantity,
              revenue: item.revenue,
              cost: item.cost,
              profit: item.profit
            })
          })
          return // Skip the general grouping for product grouping
        default:
          groupKey = saleDate.toISOString().split('T')[0]
      }

      if (!groupedProfit[groupKey]) {
        groupedProfit[groupKey] = {
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          productSales: 0,
          serviceSales: 0
        }
      }

      groupedProfit[groupKey].totalRevenue += sale.totals.revenue
      groupedProfit[groupKey].totalCost += sale.totals.cost
      groupedProfit[groupKey].totalProfit += sale.totals.profit
      groupedProfit[groupKey].productSales += 1
    })

    // Process service sales
    profitData.serviceSales.forEach(sale => {
      const saleDate = new Date(sale.date)
      let groupKey: string

      switch (groupBy) {
        case 'day':
          groupKey = saleDate.toISOString().split('T')[0]
          break
        case 'week':
          const weekNumber = Math.ceil(saleDate.getDate() / 7)
          groupKey = `${saleDate.getFullYear()}-W${weekNumber}`
          break
        case 'month':
          groupKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`
          break
        case 'service':
          // Group by service
          const serviceKey = sale.serviceName
          if (!groupedProfit[serviceKey]) {
            groupedProfit[serviceKey] = {
              type: 'service',
              totalRevenue: 0,
              totalCost: 0,
              totalProfit: 0,
              totalSales: 0,
              sales: []
            }
          }
          groupedProfit[serviceKey].totalRevenue += sale.servicePrice
          groupedProfit[serviceKey].totalCost += sale.serviceCost
          groupedProfit[serviceKey].totalProfit += sale.serviceProfit
          groupedProfit[serviceKey].totalSales += 1
          groupedProfit[serviceKey].sales.push({
            saleId: sale.saleId,
            date: sale.date,
            revenue: sale.servicePrice,
            cost: sale.serviceCost,
            profit: sale.serviceProfit,
            margin: sale.serviceMargin
          })
          return // Skip the general grouping for service grouping
        default:
          groupKey = saleDate.toISOString().split('T')[0]
      }

      if (!groupedProfit[groupKey]) {
        groupedProfit[groupKey] = {
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          productSales: 0,
          serviceSales: 0
        }
      }

      groupedProfit[groupKey].totalRevenue += sale.servicePrice
      groupedProfit[groupKey].totalCost += sale.serviceCost
      groupedProfit[groupKey].totalProfit += sale.serviceProfit
      groupedProfit[groupKey].serviceSales += 1
    })

    // 7. Calculate overall totals
   
    const overallTotals: any = {
        totalRevenue: profitData.productSales.reduce((sum: number, sale: any) => sum + sale.totals.revenue, 0) +
                    profitData.serviceSales.reduce((sum: number, sale: any) => sum + sale.servicePrice, 0),
        totalCost: profitData.productSales.reduce((sum: number, sale: any) => sum + sale.totals.cost, 0) +
                profitData.serviceSales.reduce((sum: number, sale: any) => sum + sale.serviceCost, 0),
        totalProfit: profitData.productSales.reduce((sum: number, sale: any) => sum + sale.totals.profit, 0) +
                    profitData.serviceSales.reduce((sum: number, sale: any) => sum + sale.serviceProfit, 0),
        totalProductSales: profitData.productSales.length,
        totalServiceSales: profitData.serviceSales.length
    }
  
  overallTotals.profitMargin = overallTotals.totalRevenue > 0 
    ? (overallTotals.totalProfit / overallTotals.totalRevenue) * 100 
    : 0

    // 8. Format response based on requested format
    if (format === 'csv') {
      const csvRows = []
      
      if (groupBy === 'product' || groupBy === 'service') {
        // Detailed product/service CSV
        csvRows.push(['Name', 'Type', 'Total Revenue', 'Total Cost', 'Total Profit', 'Profit Margin %', 'Sales Count'])
        
        Object.entries(groupedProfit).forEach(([name, data]: [string, any]) => {
          const margin = data.totalRevenue > 0 ? (data.totalProfit / data.totalRevenue) * 100 : 0
          csvRows.push([
            name,
            data.type,
            data.totalRevenue.toFixed(2),
            data.totalCost.toFixed(2),
            data.totalProfit.toFixed(2),
            margin.toFixed(2),
            data.type === 'product' ? data.totalQuantity : data.totalSales
          ])
        })
      } else {
        // Time-based CSV
        csvRows.push(['Period', 'Total Revenue', 'Total Cost', 'Total Profit', 'Profit Margin %', 'Product Sales', 'Service Sales'])
        
        Object.entries(groupedProfit).forEach(([period, data]: [string, any]) => {
          const margin = data.totalRevenue > 0 ? (data.totalProfit / data.totalRevenue) * 100 : 0
          csvRows.push([
            period,
            data.totalRevenue.toFixed(2),
            data.totalCost.toFixed(2),
            data.totalProfit.toFixed(2),
            margin.toFixed(2),
            data.productSales || 0,
            data.serviceSales || 0
          ])
        })
      }

      // Add totals row
      const totalMargin = overallTotals.totalRevenue > 0 
        ? (overallTotals.totalProfit / overallTotals.totalRevenue) * 100 
        : 0
      
      csvRows.push([
        'TOTAL',
        overallTotals.totalRevenue.toFixed(2),
        overallTotals.totalCost.toFixed(2),
        overallTotals.totalProfit.toFixed(2),
        totalMargin.toFixed(2),
        overallTotals.totalProductSales,
        overallTotals.totalServiceSales
      ])

      const csvContent = csvRows.map(row => row.join(',')).join('\n')
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="profit-report-${groupBy}-${new Date().toISOString().split('T')[0]}.csv"`
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
          overallTotals
        },
        groupedData: groupedProfit,
        detailedData: includeCosts ? {
          productSales: profitData.productSales,
          serviceSales: profitData.serviceSales
        } : undefined,
        margins: includeMargins ? {
          averageProductMargin: profitData.productSales.length > 0
            ? profitData.productSales.reduce((sum, sale) => sum + sale.totals.profitMargin, 0) / profitData.productSales.length
            : 0,
          averageServiceMargin: profitData.serviceSales.length > 0
            ? profitData.serviceSales.reduce((sum, sale) => sum + sale.serviceMargin, 0) / profitData.serviceSales.length
            : 0,
          topPerformingProducts: profitData.productSales
            .flatMap(sale => sale.items)
            .reduce((acc: any, item) => {
              if (!acc[item.productName]) {
                acc[item.productName] = {
                  totalProfit: 0,
                  totalRevenue: 0,
                  totalQuantity: 0
                }
              }
              acc[item.productName].totalProfit += item.profit
              acc[item.productName].totalRevenue += item.revenue
              acc[item.productName].totalQuantity += item.quantity
              return acc
            }, {})
        } : undefined
      },
      message: 'Profit report generated successfully'
    })

  } catch (error) {
    console.error('GET /api/reports/profit error:', error)
    
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