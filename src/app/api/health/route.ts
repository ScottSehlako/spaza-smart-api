import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Dynamically import to avoid build issues
    const { prisma } = await import('@/lib/prisma')
    
    await prisma.$queryRaw`SELECT 1`
    
    const counts = await Promise.allSettled([
      prisma.business.count(),
      prisma.user.count(),
      prisma.product.count(),
      prisma.service.count(),
      prisma.sale.count()
    ])
    
    const stats = {
      businesses: counts[0].status === 'fulfilled' ? counts[0].value : 0,
      users: counts[1].status === 'fulfilled' ? counts[1].value : 0,
      products: counts[2].status === 'fulfilled' ? counts[2].value : 0,
      services: counts[3].status === 'fulfilled' ? counts[3].value : 0,
      sales: counts[4].status === 'fulfilled' ? counts[4].value : 0,
    }
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      environment: process.env.NODE_ENV,
      phase: 2,
      stats
    })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}