import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serviceReportQuerySchema } from '@/lib/validations/report'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// Define types for our data structures
interface ProductUsageItem {
  productId: string
  productName: string
  quantityUsed: number
  unitCost: number
  totalCost: number
}

interface ServiceData {
  serviceId: string
  serviceName: string
  basePrice: number
  durationMinutes: number | null
  totalSales: number
  totalRevenue: number
  totalProductCost: number
  totalProfit: number
  profitMargin: number
  averageSaleValue: number
  productUsage: Array<{
    productName: string
    totalQuantity: number
    totalCost: number
  }>
  salesByEmployee: Record<string, number>
  suggestedProducts: Array<{
    productName: string
    suggestedQuantity: number
    unitCost: number
    suggestedCost: number
  }>
  recentSales: Array<{
    date: Date
    employee: string
    client: string
    productCount: number
    totalProductCost: number
  }>
}

// GET /api/reports/services - Service performance reports
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
      includeProductUsage: searchParams.get('includeProductUsage') || 'true',
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

    const query = serviceReportQuerySchema.parse(queryInput)

    const { 
      startDate, endDate, groupBy, 
      includeProductUsage, format 
    } = query

    // 3. Build date range filter
    const dateFilter: any = {}
    if (startDate) {
      dateFilter.gte = new Date(startDate)
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate)
    }

    // 4. Fetch service data with proper typing
    const services = await prisma.service.findMany({
      where: {
        businessId: authUser.businessId!,
        isActive: true
      },
      include: {
        serviceSales: {
          where: {
            createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
          },
          include: {
            productUsages: includeProductUsage ? {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    costPerUnit: true
                  }
                }
              }
            } : false,
            appointment: {
              select: {
                clientName: true,
                scheduledDate: true
              }
            },
            createdBy: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        suggestedProducts: {
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

    // 5. Process service data with proper typing
    const serviceData: ServiceData[] = services.map(service => {
      const sales = service.serviceSales
      const totalSales = sales.length
      const totalRevenue = sales.reduce((sum, sale) => sum + service.basePrice, 0)
      
      // Calculate product usage and costs
      const productUsage: ProductUsageItem[] = []
      let totalProductCost = 0

      if (includeProductUsage) {
        sales.forEach(sale => {
          sale.productUsages.forEach(usage => {
            // Type assertion for product usage with product relation
            const typedUsage = usage as any
            const product = typedUsage.product
            
            if (product) {
              const usageItem: ProductUsageItem = {
                productId: product.id,
                productName: product.name,
                quantityUsed: typedUsage.quantityUsed,
                unitCost: product.costPerUnit,
                totalCost: typedUsage.quantityUsed * product.costPerUnit
              }
              productUsage.push(usageItem)
              totalProductCost += usageItem.totalCost
            }
          })
        })
      }

      // Group product usage by product
      const productUsageByProduct = productUsage.reduce((acc: Record<string, {
        productName: string
        totalQuantity: number
        totalCost: number
      }>, usage) => {
        if (!acc[usage.productId]) {
          acc[usage.productId] = {
            productName: usage.productName,
            totalQuantity: 0,
            totalCost: 0
          }
        }
        acc[usage.productId].totalQuantity += usage.quantityUsed
        acc[usage.productId].totalCost += usage.totalCost
        return acc
      }, {})

      const totalProfit = totalRevenue - totalProductCost
      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

      // Analyze by employee if available
      const salesByEmployee: Record<string, number> = {}
      sales.forEach(sale => {
        const employeeName = sale.createdBy.name
        salesByEmployee[employeeName] = (salesByEmployee[employeeName] || 0) + 1
      })

      // Get recent sales
      const recentSales = sales.slice(0, 5).map(sale => {
        const productCost = sale.productUsages.reduce((sum, usage) => {
          const typedUsage = usage as any
          return sum + (typedUsage.quantityUsed * (typedUsage.product?.costPerUnit || 0))
        }, 0)

        return {
          date: sale.createdAt,
          employee: sale.createdBy.name,
          client: sale.appointment?.clientName || 'Walk-in',
          productCount: sale.productUsages.length,
          totalProductCost: productCost
        }
      })

      // Process suggested products
      const suggestedProducts = service.suggestedProducts.map(sp => {
        const typedSp = sp as any
        return {
          productName: typedSp.product.name,
          suggestedQuantity: typedSp.suggestedQuantity,
          unitCost: typedSp.product.costPerUnit,
          suggestedCost: typedSp.suggestedQuantity * typedSp.product.costPerUnit
        }
      })

      return {
        serviceId: service.id,
        serviceName: service.name,
        basePrice: service.basePrice,
        durationMinutes: service.durationMinutes,
        totalSales,
        totalRevenue,
        totalProductCost,
        totalProfit,
        profitMargin,
        averageSaleValue: totalSales > 0 ? totalRevenue / totalSales : 0,
        productUsage: Object.values(productUsageByProduct),
        salesByEmployee,
        suggestedProducts,
        recentSales
      }
    })

    // 6. Group data based on groupBy parameter
    let groupedData: Record<string, any> = {}

    if (groupBy === 'service') {
      // Already grouped by service
      serviceData.forEach(service => {
        groupedData[service.serviceName] = service
      })
    } else {
      // Group by time period
      serviceData.forEach(service => {
        service.recentSales.forEach(sale => {
          const saleDate = sale.date
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
            case 'employee':
              groupKey = sale.employee
              break
            default:
              groupKey = saleDate.toISOString().split('T')[0]
          }

          if (!groupedData[groupKey]) {
            groupedData[groupKey] = {
              totalServices: 0,
              totalRevenue: 0,
              totalProductCost: 0,
              services: [] as string[]
            }
          }

          groupedData[groupKey].totalServices += 1
          groupedData[groupKey].totalRevenue += service.basePrice
          groupedData[groupKey].totalProductCost += sale.totalProductCost
          
          if (!groupedData[groupKey].services.includes(service.serviceName)) {
            groupedData[groupKey].services.push(service.serviceName)
          }
        })
      })

      // Calculate profit for each group
      Object.keys(groupedData).forEach(key => {
        const group = groupedData[key]
        group.totalProfit = group.totalRevenue - group.totalProductCost
        group.profitMargin = group.totalRevenue > 0 ? (group.totalProfit / group.totalRevenue) * 100 : 0
        group.averageServiceValue = group.totalServices > 0 ? group.totalRevenue / group.totalServices : 0
      })
    }

    // 7. Calculate overall totals
    const overallTotals = {
      totalServices: serviceData.reduce((sum, service) => sum + service.totalSales, 0),
      totalRevenue: serviceData.reduce((sum, service) => sum + service.totalRevenue, 0),
      totalProductCost: serviceData.reduce((sum, service) => sum + service.totalProductCost, 0),
      totalProfit: serviceData.reduce((sum, service) => sum + service.totalProfit, 0),
      uniqueServices: services.length,
      averageProfitMargin: serviceData.length > 0
        ? serviceData.reduce((sum, service) => sum + service.profitMargin, 0) / serviceData.length
        : 0
    }

    // 8. Identify top performing services
    const topPerformingServices = [...serviceData]
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .slice(0, 5)

    // 9. Format response based on requested format
    if (format === 'csv') {
      const csvRows: string[][] = []
      
      if (groupBy === 'service') {
        csvRows.push(['Service Name', 'Base Price', 'Total Sales', 'Total Revenue', 'Product Cost', 'Total Profit', 'Profit Margin %', 'Avg Sale Value'])
        
        serviceData.forEach(service => {
          csvRows.push([
            service.serviceName,
            service.basePrice.toFixed(2),
            service.totalSales.toString(),
            service.totalRevenue.toFixed(2),
            service.totalProductCost.toFixed(2),
            service.totalProfit.toFixed(2),
            service.profitMargin.toFixed(2),
            service.averageSaleValue.toFixed(2)
          ])
        })
      } else {
        csvRows.push(['Period/Group', 'Total Services', 'Total Revenue', 'Product Cost', 'Total Profit', 'Profit Margin %', 'Avg Service Value', 'Services Offered'])
        
        Object.entries(groupedData).forEach(([group, data]: [string, any]) => {
          csvRows.push([
            group,
            data.totalServices.toString(),
            data.totalRevenue.toFixed(2),
            data.totalProductCost.toFixed(2),
            data.totalProfit.toFixed(2),
            data.profitMargin.toFixed(2),
            data.averageServiceValue.toFixed(2),
            data.services.join('; ')
          ])
        })
      }

      // Add totals row
      const overallMargin = overallTotals.totalRevenue > 0 
        ? (overallTotals.totalProfit / overallTotals.totalRevenue) * 100 
        : 0
      
      csvRows.push([
        'TOTAL',
        overallTotals.totalServices.toString(),
        overallTotals.totalRevenue.toFixed(2),
        overallTotals.totalProductCost.toFixed(2),
        overallTotals.totalProfit.toFixed(2),
        overallMargin.toFixed(2),
        (overallTotals.totalServices > 0 ? overallTotals.totalRevenue / overallTotals.totalServices : 0).toFixed(2),
        `Unique Services: ${overallTotals.uniqueServices}`
      ])

      const csvContent = csvRows.map(row => row.join(',')).join('\n')
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="service-report-${groupBy}-${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    // 10. Return JSON response (default)
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
        groupedData,
        servicePerformance: serviceData,
        topPerformingServices,
        productUsageAnalysis: includeProductUsage ? {
          totalProductsUsed: serviceData.reduce((sum, service) => 
            sum + service.productUsage.length, 0
          ),
          mostUsedProducts: serviceData
            .flatMap(service => service.productUsage)
            .reduce((acc: Record<string, {
              totalQuantity: number
              totalCost: number
              usedInServices: number
            }>, product: any) => {
              if (!acc[product.productName]) {
                acc[product.productName] = {
                  totalQuantity: 0,
                  totalCost: 0,
                  usedInServices: 0
                }
              }
              acc[product.productName].totalQuantity += product.totalQuantity
              acc[product.productName].totalCost += product.totalCost
              acc[product.productName].usedInServices += 1
              return acc
            }, {})
        } : undefined
      },
      message: 'Service report generated successfully'
    })

  } catch (error) {
    console.error('GET /api/reports/services error:', error)
    
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