import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { inventoryReportQuerySchema } from '@/lib/validations/report'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// GET /api/reports/inventory - Inventory reports
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
      reportType: searchParams.get('reportType') || 'movement',
      lowStockOnly: searchParams.get('lowStockOnly') || 'false',
      includeInactive: searchParams.get('includeInactive') || 'false',
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

    const query = inventoryReportQuerySchema.parse(queryInput)

    const { 
      startDate, endDate, reportType, 
      lowStockOnly, includeInactive, format 
    } = query

    // 3. Build where clause for products
    const productWhere: any = {
      businessId: authUser.businessId!
    }

    if (!includeInactive) {
      productWhere.isActive = true
    }

    if (lowStockOnly) {
      productWhere.reorderThreshold = { not: null }
      productWhere.quantity = {
        lte: prisma.product.fields.reorderThreshold
      }
    }

    // 4. Build date range filter for movements
    const dateFilter: any = {}
    if (startDate) {
      dateFilter.gte = new Date(startDate)
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate)
    }

    let reportData: any = {}

    switch (reportType) {
      case 'movement':
        // Stock movement report
        const movements = await prisma.stockMovement.findMany({
          where: {
            businessId: authUser.businessId!,
            createdAt: Object.keys(dateFilter).length > 0 ? dateFilter : undefined
          },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unitOfMeasure: true
              }
            },
            createdBy: {
              select: {
                id: true,
                name: true
              }
            },
            saleItem: {
              include: {
                sale: {
                  select: {
                    receiptNumber: true,
                    customerName: true
                  }
                }
              }
            },
            productUsage: {
              include: {
                serviceSale: {
                  include: {
                    service: {
                      select: {
                        name: true
                      }
                    }
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 100 // Limit for performance
        })

        reportData = {
          movements: movements.map(movement => ({
            id: movement.id,
            date: movement.createdAt,
            product: movement.product.name,
            type: movement.type,
            quantity: movement.quantity,
            previousQuantity: movement.previousQuantity,
            newQuantity: movement.newQuantity,
            performedBy: movement.createdBy.name,
            reference: movement.referenceType === 'sale' 
              ? `Sale: ${movement.saleItem?.sale.receiptNumber}`
              : movement.referenceType === 'ServiceSale'
                ? `Service: ${movement.productUsage?.serviceSale.service.name}`
                : movement.notes
          })),
          summary: {
            totalMovements: movements.length,
            byType: movements.reduce((acc: any, movement) => {
              acc[movement.type] = (acc[movement.type] || 0) + 1
              return acc
            }, {}),
            netChange: movements.reduce((acc, movement) => {
              if (movement.type === 'PURCHASE' || movement.type === 'RETURN') {
                return acc + movement.quantity
              } else {
                return acc - movement.quantity
              }
            }, 0)
          }
        }
        break

      case 'status':
        // Current inventory status
        const products = await prisma.product.findMany({
          where: productWhere,
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
              orderBy: { createdAt: 'desc' },
              take: 5
            }
          },
          orderBy: [
            { isActive: 'desc' },
            { name: 'asc' }
          ]
        })

        const inventoryValue = products.reduce((total, product) => {
          return total + (product.quantity * product.costPerUnit)
        }, 0)

        const salesValue = products.reduce((total, product) => {
          return total + (product.quantity * product.sellingPrice)
        }, 0)

        reportData = {
          products: products.map(product => ({
            id: product.id,
            name: product.name,
            sku: product.sku,
            barcode: product.barcode?.code,
            quantity: product.quantity,
            unitOfMeasure: product.unitOfMeasure,
            costPerUnit: product.costPerUnit,
            sellingPrice: product.sellingPrice,
            reorderThreshold: product.reorderThreshold,
            isActive: product.isActive,
            status: product.reorderThreshold && product.quantity <= product.reorderThreshold 
              ? 'LOW_STOCK' 
              : 'OK',
            inventoryValue: product.quantity * product.costPerUnit,
            salesValue: product.quantity * product.sellingPrice,
            recentMovements: product.stockMovements.map(movement => ({
              type: movement.type,
              quantity: movement.quantity,
              date: movement.createdAt
            }))
          })),
          summary: {
            totalProducts: products.length,
            activeProducts: products.filter(p => p.isActive).length,
            lowStockProducts: products.filter(p => 
              p.reorderThreshold && p.quantity <= p.reorderThreshold
            ).length,
            totalQuantity: products.reduce((sum, p) => sum + p.quantity, 0),
            inventoryValue,
            potentialSalesValue: salesValue,
            averageStockValue: inventoryValue / products.length
          }
        }
        break

      case 'valuation':
        // Inventory valuation report
        const valuationProducts = await prisma.product.findMany({
          where: productWhere,
          select: {
            id: true,
            name: true,
            quantity: true,
            unitOfMeasure: true,
            costPerUnit: true,
            sellingPrice: true,
            isConsumable: true
          },
          orderBy: { name: 'asc' }
        })

        const categories = {
          consumable: valuationProducts.filter(p => p.isConsumable),
          nonConsumable: valuationProducts.filter(p => !p.isConsumable)
        }

        reportData = {
          categories: {
            consumable: {
              products: categories.consumable.map(p => ({
                name: p.name,
                quantity: p.quantity,
                unitCost: p.costPerUnit,
                totalCost: p.quantity * p.costPerUnit,
                unitPrice: p.sellingPrice,
                totalValue: p.quantity * p.sellingPrice
              })),
              totalCost: categories.consumable.reduce((sum, p) => sum + (p.quantity * p.costPerUnit), 0),
              totalValue: categories.consumable.reduce((sum, p) => sum + (p.quantity * p.sellingPrice), 0)
            },
            nonConsumable: {
              products: categories.nonConsumable.map(p => ({
                name: p.name,
                quantity: p.quantity,
                unitCost: p.costPerUnit,
                totalCost: p.quantity * p.costPerUnit,
                unitPrice: p.sellingPrice,
                totalValue: p.quantity * p.sellingPrice
              })),
              totalCost: categories.nonConsumable.reduce((sum, p) => sum + (p.quantity * p.costPerUnit), 0),
              totalValue: categories.nonConsumable.reduce((sum, p) => sum + (p.quantity * p.sellingPrice), 0)
            }
          },
          summary: {
            totalProducts: valuationProducts.length,
            totalInventoryCost: valuationProducts.reduce((sum, p) => sum + (p.quantity * p.costPerUnit), 0),
            totalInventoryValue: valuationProducts.reduce((sum, p) => sum + (p.quantity * p.sellingPrice), 0),
            potentialProfit: valuationProducts.reduce((sum, p) => 
              sum + (p.quantity * (p.sellingPrice - p.costPerUnit)), 0
            )
          }
        }
        break
    }

    // 5. Format response based on requested format
    if (format === 'csv') {
      let csvRows = []
      
      switch (reportType) {
        case 'movement':
          csvRows.push(['Date', 'Product', 'Type', 'Quantity', 'Previous Qty', 'New Qty', 'Performed By', 'Reference'])
          reportData.movements.forEach((movement: any) => {
            csvRows.push([
              new Date(movement.date).toLocaleDateString(),
              movement.product,
              movement.type,
              movement.quantity,
              movement.previousQuantity,
              movement.newQuantity,
              movement.performedBy,
              movement.reference
            ])
          })
          break
        
        case 'status':
          csvRows.push(['Product', 'SKU', 'Quantity', 'Unit', 'Cost/Unit', 'Price/Unit', 'Status', 'Inventory Value', 'Sales Value'])
          reportData.products.forEach((product: any) => {
            csvRows.push([
              product.name,
              product.sku || '',
              product.quantity,
              product.unitOfMeasure,
              product.costPerUnit.toFixed(2),
              product.sellingPrice.toFixed(2),
              product.status,
              product.inventoryValue.toFixed(2),
              product.salesValue.toFixed(2)
            ])
          })
          break
        
        case 'valuation':
          csvRows.push(['Category', 'Product', 'Quantity', 'Unit Cost', 'Total Cost', 'Unit Price', 'Total Value'])
          Object.entries(reportData.categories).forEach(([category, data]: [string, any]) => {
            data.products.forEach((product: any) => {
              csvRows.push([
                category,
                product.name,
                product.quantity,
                product.unitCost.toFixed(2),
                product.totalCost.toFixed(2),
                product.unitPrice.toFixed(2),
                product.totalValue.toFixed(2)
              ])
            })
          })
          break
      }

      const csvContent = csvRows.map(row => row.join(',')).join('\n')
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="inventory-${reportType}-report-${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    // 6. Return JSON response (default)
    return NextResponse.json({
      success: true,
      data: {
        reportType,
        period: {
          startDate: startDate || 'all',
          endDate: endDate || 'all'
        },
        filters: {
          lowStockOnly,
          includeInactive
        },
        ...reportData
      },
      message: 'Inventory report generated successfully'
    })

  } catch (error) {
    console.error('GET /api/reports/inventory error:', error)
    
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