import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, generateToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }
    
    const user = await prisma.user.findFirst({
      where: { email },
      include: { business: true }
    })
    
    if (!user) {
      throw new AuthError('Invalid credentials')
    }
    
    // Use proper password verification
    const isValidPassword = await verifyPassword(password, user.passwordHash)
    
    if (!isValidPassword) {
      throw new AuthError('Invalid credentials')
    }
    
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    })
    
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId || undefined
    })
    
    // Create audit log (optional for login)
    try {
      await prisma.auditLog.create({
        data: {
          action: 'USER_LOGIN',
          entityType: 'User',
          entityId: user.id,
          businessId: user.businessId,
          performedById: user.id,
          ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
          userAgent: req.headers.get('user-agent') || 'unknown',
        }
      })
    } catch (auditError) {
      console.warn('Failed to create audit log for login:', auditError)
      // Continue even if audit log fails
    }
    
    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
        businessName: user.business?.name
      }
    })
    
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }
    
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}