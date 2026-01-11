import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth'

// GET /api/reports - List available reports
export async function GET(request: NextRequest) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request)
    const authUser = requireBusinessAccess(user)

    // 2. Get available reports based on user role
    const reports = [
      {
        id: 'sales',
        name: 'Sales Reports',
        description: 'Sales performance and transactions',
        endpoints: [
          { method: 'GET', path: '/api/reports/sales', description: 'Sales summary and trends' },
          { method: 'GET', path: '/api/reports/sales/daily', description: 'Daily sales breakdown' },
          { method: 'GET', path: '/api/reports/sales/monthly', description: 'Monthly sales report' }
        ],
        availableTo: ['MANAGER', 'ACCOUNTANT']
      },
      {
        id: 'inventory',
        name: 'Inventory Reports',
        description: 'Stock movements and status',
        endpoints: [
          { method: 'GET', path: '/api/reports/inventory', description: 'Inventory overview' },
          { method: 'GET', path: '/api/reports/inventory/movement', description: 'Stock movement history' },
          { method: 'GET', path: '/api/reports/inventory/low-stock', description: 'Low stock alerts' }
        ],
        availableTo: ['MANAGER', 'ACCOUNTANT']
      },
      {
        id: 'profit',
        name: 'Profit Analysis',
        description: 'Profit margins and cost analysis',
        endpoints: [
          { method: 'GET', path: '/api/reports/profit', description: 'Overall profit analysis' },
          { method: 'GET', path: '/api/reports/profit/by-product', description: 'Profit per product' },
          { method: 'GET', path: '/api/reports/profit/by-service', description: 'Profit per service' }
        ],
        availableTo: ['MANAGER', 'ACCOUNTANT']
      },
      {
        id: 'services',
        name: 'Service Performance',
        description: 'Service utilization and performance',
        endpoints: [
          { method: 'GET', path: '/api/reports/services', description: 'Service performance overview' },
          { method: 'GET', path: '/api/reports/services/usage', description: 'Service product usage' }
        ],
        availableTo: ['MANAGER', 'ACCOUNTANT']
      },
      {
        id: 'export',
        name: 'Data Export',
        description: 'Export data in various formats',
        endpoints: [
          { method: 'GET', path: '/api/reports/export', description: 'Export data (CSV, PDF, Excel)' }
        ],
        availableTo: ['MANAGER', 'ACCOUNTANT']
      }
    ]

    // 3. Filter reports based on user role
    const availableReports = reports.filter(report => 
      report.availableTo.includes(authUser.role)
    )

    // 4. Return response
    return NextResponse.json({
      success: true,
      data: {
        reports: availableReports,
        user: {
          id: authUser.id,
          role: authUser.role,
          businessId: authUser.businessId
        }
      },
      message: 'Available reports listed successfully'
    })

  } catch (error) {
    console.error('GET /api/reports error:', error)

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