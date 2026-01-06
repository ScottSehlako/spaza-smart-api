import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, extractToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface AuthContext {
  userId: string
  email: string
  role: string
  businessId?: string
  user?: any
}

export async function authenticate(req: NextRequest): Promise<AuthContext> {
  try {
    const authHeader = req.headers.get('authorization')
    const token = extractToken(authHeader || undefined)
    const payload = verifyToken(token)
    
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { business: true }
    })
    
    if (!user) {
      throw new AuthError('User not found')
    }
    
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId || undefined,
      user
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error
    }
    throw new AuthError('Authentication failed')
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (context: AuthContext) => {
    if (!allowedRoles.includes(context.role)) {
      throw new AuthError(`Insufficient permissions. Required roles: ${allowedRoles.join(', ')}`)
    }
  }
}

export function requireBusinessScope(context: AuthContext) {
  if (!context.businessId) {
    throw new AuthError('User is not associated with a business')
  }
  return context.businessId
}

export async function withAuth(
  req: NextRequest,
  handler: (context: AuthContext) => Promise<NextResponse>,
  options?: {
    requiredRoles?: string[]
    requireBusiness?: boolean
  }
): Promise<NextResponse> {
  try {
    const context = await authenticate(req)
    
    if (options?.requiredRoles) {
      requireRole(...options.requiredRoles)(context)
    }
    
    if (options?.requireBusiness) {
      requireBusinessScope(context)
    }
    
    return await handler(context)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      )
    }
    
    console.error('Auth middleware error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}