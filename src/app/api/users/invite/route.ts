import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'
import { hashPassword } from '@/lib/auth'
import { UserRole } from '@prisma/client'

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (context) => {
      if (context.role !== 'MANAGER') {
        return NextResponse.json(
          { error: 'Only managers can invite users' },
          { status: 403 }
        )
      }
      
      const { email, name, role, phone } = await req.json()
      
      if (!email || !name || !role) {
        return NextResponse.json(
          { error: 'Email, name, and role are required' },
          { status: 400 }
        )
      }
      
      const validRoles = Object.values(UserRole)
      if (!validRoles.includes(role as UserRole)) {
        return NextResponse.json(
          { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
          { status: 400 }
        )
      }
      
      const { prisma } = await import('@/lib/prisma')
      
      const existingUser = await prisma.user.findFirst({
        where: {
          email,
          businessId: context.businessId
        }
      })
      
      if (existingUser) {
        return NextResponse.json(
          { error: 'User already exists in this business' },
          { status: 409 }
        )
      }
      
      const tempPassword = Math.random().toString(36).slice(-8)
      const passwordHash = await hashPassword(tempPassword)
      
      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: role as UserRole,
          phone,
          businessId: context.businessId!,
          invitedById: context.userId,
        }
      })
      
      await prisma.auditLog.create({
        data: {
          action: 'USER_INVITED',
          entityType: 'User',
          entityId: user.id,
          businessId: context.businessId,
          performedById: context.userId,
          newValue: { email, name, role, invitedBy: context.userId },
          ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
          userAgent: req.headers.get('user-agent') || 'unknown',
        }
      })
      
      return NextResponse.json({
        success: true,
        message: 'User invited successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tempPassword
        }
      }, { status: 201 })
    },
    {
      requiredRoles: ['MANAGER'],
      requireBusiness: true
    }
  )
}