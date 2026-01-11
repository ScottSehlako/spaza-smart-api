import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { exportQuerySchema } from '@/lib/validations/report'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// GET /api/reports/export - Export data in various formats
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user (Manager or Accountant only)
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)
    
    if (!['MANAGER', 'ACCOUNTANT'].includes(authUser.role)) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Only managers and accountants can access exports' 
        },
        { status: 403 }
      )
    }

    // 2. Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams
    
    const queryInput: Record<string, any> = {
      reportType: searchParams.get('reportType') || 'all',
      format: searchParams.get('format') || 'csv'
    }

    // Date filters
    const optionalDateFields = ['startDate', 'endDate']
    optionalDateFields.forEach(field => {
      const value = searchParams.get(field)
      if (value !== null) {
        queryInput[field] = value
      }
    })

    const query = exportQuerySchema.parse(queryInput)

    const { 
      reportType, format, startDate, endDate 
    } = query

    // 3. Build date range filter
    const dateFilter: any = {}
    if (startDate) {
      dateFilter.gte = new Date(startDate)
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate)
    }

    // 4. Fetch data based on report type
    let exportData: any = {}
    let filename = ''

    switch (reportType) {
      case 'sales':
        const sales = await prisma.sale.findMany({
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
                    name: true,
                    costPerUnit: true
                  }
                }
              }
            },
            createdBy: {
              select: {
                name: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        })

        const serviceSales = await prisma.serviceSale.findMany({
          where: {
            businessId: authUser.businessId!,
            createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
          },
          include: {
            service: {
              select: {
                name: true,
                basePrice: true
              }
            },
            productUsages: {
              include: {
                product: {
                  select: {
                    name: true,
                    costPerUnit: true
                  }
                }
              }
            },
            createdBy: {
              select: {
                name: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        })

        exportData = {
          productSales: sales.map(sale => ({
            id: sale.id,
            receiptNumber: sale.receiptNumber,
            date: sale.createdAt,
            customerName: sale.customerName,
            customerPhone: sale.customerPhone,
            totalAmount: sale.totalAmount,
            createdBy: sale.createdBy.name,
            items: sale.saleItems.map(item => ({
              product: item.product.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              cost: item.quantity * item.product.costPerUnit,
              profit: item.totalPrice - (item.quantity * item.product.costPerUnit)
            }))
          })),
          serviceSales: serviceSales.map(sale => ({
            id: sale.id,
            date: sale.createdAt,
            service: sale.service.name,
            basePrice: sale.service.basePrice,
            createdBy: sale.createdBy.name,
            productUsage: sale.productUsages.map(usage => ({
              product: usage.product.name,
              quantityUsed: usage.quantityUsed,
              unitCost: usage.product.costPerUnit,
              totalCost: usage.quantityUsed * usage.product.costPerUnit
            }))
          }))
        }
        
        filename = `sales-export-${new Date().toISOString().split('T')[0]}`
        break

      case 'inventory':
        const products = await prisma.product.findMany({
          where: {
            businessId: authUser.businessId!
          },
          include: {
            barcode: {
              select: {
                code: true
              }
            },
            stockMovements: {
              where: {
                createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
              },
              orderBy: { createdAt: 'desc' }
            }
          },
          orderBy: { name: 'asc' }
        })

        exportData = {
          products: products.map(product => ({
            name: product.name,
            sku: product.sku,
            barcode: product.barcode?.code,
            description: product.description,
            quantity: product.quantity,
            unitOfMeasure: product.unitOfMeasure,
            costPerUnit: product.costPerUnit,
            sellingPrice: product.sellingPrice,
            reorderThreshold: product.reorderThreshold,
            optimalQuantity: product.optimalQuantity,
            isConsumable: product.isConsumable,
            isActive: product.isActive,
            inventoryValue: product.quantity * product.costPerUnit,
            salesValue: product.quantity * product.sellingPrice,
            movements: product.stockMovements.map(movement => ({
              date: movement.createdAt,
              type: movement.type,
              quantity: movement.quantity,
              previousQuantity: movement.previousQuantity,
              newQuantity: movement.newQuantity,
              notes: movement.notes
            }))
          }))
        }
        
        filename = `inventory-export-${new Date().toISOString().split('T')[0]}`
        break

      case 'services':
        const services = await prisma.service.findMany({
          where: {
            businessId: authUser.businessId!
          },
          include: {
            serviceSales: {
              where: {
                createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
              },
              include: {
                productUsages: {
                  include: {
                    product: {
                      select: {
                        name: true,
                        costPerUnit: true
                      }
                    }
                  }
                },
                createdBy: {
                  select: {
                    name: true
                  }
                }
              }
            },
            suggestedProducts: {
              include: {
                product: {
                  select: {
                    name: true,
                    costPerUnit: true
                  }
                }
              }
            }
          }
        })

        exportData = {
          services: services.map(service => ({
            name: service.name,
            description: service.description,
            basePrice: service.basePrice,
            durationMinutes: service.durationMinutes,
            isActive: service.isActive,
            totalSales: service.serviceSales.length,
            totalRevenue: service.serviceSales.reduce((sum, sale) => sum + service.basePrice, 0),
            suggestedProducts: service.suggestedProducts.map(sp => ({
              product: sp.product.name,
              suggestedQuantity: sp.suggestedQuantity,
              suggestedCost: sp.suggestedQuantity * sp.product.costPerUnit
            })),
            sales: service.serviceSales.map(sale => ({
              date: sale.createdAt,
              createdBy: sale.createdBy.name,
              productUsage: sale.productUsages.map(usage => ({
                product: usage.product.name,
                quantityUsed: usage.quantityUsed,
                unitCost: usage.product.costPerUnit,
                totalCost: usage.quantityUsed * usage.product.costPerUnit
              }))
            }))
          }))
        }
        
        filename = `services-export-${new Date().toISOString().split('T')[0]}`
        break

      case 'all':
        // Export all data
        const allSales = await prisma.sale.findMany({
          where: {
            businessId: authUser.businessId!,
            createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
          },
          include: {
            saleItems: {
              include: {
                product: true
              }
            }
          }
        })

        const allServiceSales = await prisma.serviceSale.findMany({
          where: {
            businessId: authUser.businessId!,
            createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
          },
          include: {
            service: true,
            productUsages: {
              include: {
                product: true
              }
            }
          }
        })

        const allProducts = await prisma.product.findMany({
          where: {
            businessId: authUser.businessId!
          }
        })

        const allServices = await prisma.service.findMany({
          where: {
            businessId: authUser.businessId!
          }
        })

        const allAppointments = await prisma.appointment.findMany({
          where: {
            businessId: authUser.businessId!,
            createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
          },
          include: {
            service: true
          }
        })

        exportData = {
          sales: allSales,
          serviceSales: allServiceSales,
          products: allProducts,
          services: allServices,
          appointments: allAppointments
        }
        
        filename = `full-export-${new Date().toISOString().split('T')[0]}`
        break
    }

    // 5. Format response based on requested format
    if (format === 'csv') {
      // Convert to CSV (simplified version)
      let csvContent = ''
      
      if (reportType === 'all') {
        // For full export, create multiple CSV sheets or zip file
        // For simplicity, we'll just export the first dataset
        const firstDataset = Object.entries(exportData)[0]
        if (firstDataset) {
          const [name, data] = firstDataset
          if (Array.isArray(data) && data.length > 0) {
            const headers = Object.keys(data[0]).join(',')
            const rows = data.map((item: any) => 
              Object.values(item).map(val => 
                typeof val === 'object' ? JSON.stringify(val) : val
              ).join(',')
            )
            csvContent = [headers, ...rows].join('\n')
          }
        }
      } else {
        // For single report type
        const dataset = exportData[Object.keys(exportData)[0]]
        if (Array.isArray(dataset) && dataset.length > 0) {
          const headers = Object.keys(dataset[0]).join(',')
          const rows = dataset.map((item: any) => 
            Object.values(item).map(val => 
              typeof val === 'object' ? JSON.stringify(val) : val
            ).join(',')
          )
          csvContent = [headers, ...rows].join('\n')
        }
      }

      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}.csv"`
        }
      })
    }

    // 6. For PDF and Excel, we would need additional libraries
    // For now, return JSON with a message about PDF/Excel coming soon
    return NextResponse.json({
      success: true,
      data: exportData,
      message: format === 'pdf' 
        ? 'PDF export coming soon. Currently available in JSON and CSV formats.'
        : format === 'excel'
        ? 'Excel export coming soon. Currently available in JSON and CSV formats.'
        : 'Data exported successfully',
      note: 'PDF and Excel exports require additional libraries. Currently supporting JSON and CSV formats.'
    })

  } catch (error) {
    console.error('GET /api/reports/export error:', error)
    
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