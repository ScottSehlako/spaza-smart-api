import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/middleware/auth'

export async function GET(req: NextRequest) {
  return withAuth(req, async (context) => {
    return NextResponse.json({
      id: context.userId,
      email: context.email,
      role: context.role,
      businessId: context.businessId,
      name: context.user?.name,
      phone: context.user?.phone
    })
  })
}