// src/lib/api-auth.ts
import { NextRequest } from 'next/server'
import { prisma } from './prisma'
import { verifyToken, extractToken, JwtPayload, AuthError } from './auth'

export interface ApiUser {
  id: string
  email: string
  name: string
  role: string
  businessId: string | null
  business?: {
    id: string
    name: string
    type: string
  } | null
}

export async function getCurrentUserFromRequest(request: NextRequest): Promise<ApiUser | null> {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return null

    const token = extractToken(authHeader)
    const payload = verifyToken(token)
    
    // Get full user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        businessId: true,
        business: {
          select: {
            id: true,
            name: true,
            type: true
          }
        }
      }
    })
    
    return user
  } catch (error) {
    if (error instanceof AuthError) {
      console.warn('Auth error:', error.message)
    } else {
      console.error('Unexpected auth error:', error)
    }
    return null
  }
}

export function requireAuth(user: ApiUser | null): ApiUser {
  if (!user) {
    throw new AuthError('Authentication required')
  }
  return user
}

export function requireManager(user: ApiUser | null): ApiUser {
  const authUser = requireAuth(user)
  if (authUser.role !== 'MANAGER') {
    throw new AuthError('Only managers can perform this action')
  }
  return authUser
}

export function requireBusinessAccess(user: ApiUser | null): ApiUser {
  const authUser = requireAuth(user)
  if (!authUser.businessId) {
    throw new AuthError('User does not have business access')
  }
  return authUser
}

export function requireManagerWithBusiness(user: ApiUser | null): ApiUser {
  const manager = requireManager(user)
  if (!manager.businessId) {
    throw new AuthError('Manager does not have business access')
  }
  return manager
}

export { AuthError }
