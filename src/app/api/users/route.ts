import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';

// Query validation schema - FIXED VERSION (role truly optional)
const querySchema = z.object({
  page: z.string().default('1').transform(Number),
  limit: z.string().default('50').transform(Number),
  search: z.string().default(''),
  role: z.string().optional().nullable().transform(val => {
    // Handle null/undefined/empty string
    if (!val || val.trim() === '') {
      return undefined;
    }
    
    // Only accept valid roles
    const validRoles = ['MANAGER', 'EMPLOYEE', 'ACCOUNTANT'];
    if (validRoles.includes(val)) {
      return val;
    }
    
    // Return undefined for invalid roles
    return undefined;
  }),
});

// GET /api/users - List all users in the business
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const manager = requireManagerWithBusiness(user);

    const searchParams = request.nextUrl.searchParams;
    
    // Get raw values with defaults
    const rawPage = searchParams.get('page') || '1';
    const rawLimit = searchParams.get('limit') || '50';
    const rawSearch = searchParams.get('search') || '';
    const rawRole = searchParams.get('role');

    // Parse query parameters
    const query = querySchema.parse({
      page: rawPage,
      limit: rawLimit,
      search: rawSearch,
      role: rawRole,
    });

    const { page, limit, search, role } = query;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      businessId: manager.businessId!,
    };

    // Apply role filter only if valid role provided
    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          invitedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              createdSales: true,
              serviceSales: true,
              auditLogs: true,
              createdProducts: true,
              createdServices: true,
            },
          },
        },
        orderBy: [
          { role: 'asc' },
          { name: 'asc' },
        ],
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    const formattedUsers = users.map((user) => ({
      ...user,
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      invitedBy: user.invitedBy ? {
        id: user.invitedBy.id,
        name: user.invitedBy.name,
      } : null,
      stats: user._count,
    }));

    return NextResponse.json({
      success: true,
      data: formattedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error('GET /api/users error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}