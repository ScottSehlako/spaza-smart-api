import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (context) => {
      const { prisma } = await import('@/lib/prisma')
      
      const users = await prisma.user.findMany({
        where: { businessId: context.businessId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          phone: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: 'desc' }
      })
      
      return NextResponse.json({ users })
    },
    {
      requiredRoles: ['MANAGER'],
      requireBusiness: true
    }
  )
}