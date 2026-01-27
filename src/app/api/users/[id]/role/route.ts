import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Params and body validation schemas
const paramsSchema = z.object({
  id: z.string().cuid('Invalid user ID format'),
});

const updateRoleSchema = z.object({
  role: z.enum(['MANAGER', 'EMPLOYEE', 'ACCOUNTANT']),
});

// PATCH /api/users/[id]/role - Update user role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const manager = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(manager);

    const { id: userId } = await params;
    const { id } = paramsSchema.parse({ id: userId });

    const body = await request.json();
    const { role } = updateRoleSchema.parse(body);

    // Prevent managers from demoting themselves
    if (userId === authUser.id && role !== 'MANAGER') {
      return NextResponse.json(
        {
          success: false,
          error: 'You cannot change your own role from MANAGER',
        },
        { status: 400 },
      );
    }

    // Get old values for audit log
    const oldUser = await prisma.user.findUnique({
      where: {
        id: userId,
        businessId: authUser.businessId!,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    if (!oldUser) {
      return NextResponse.json(
        { success: false, error: 'User not found in your business' },
        { status: 404 },
      );
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
        businessId: authUser.businessId!,
      },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        updatedAt: true,
      },
    });

    // Create audit log - Use UPDATE action
    await RequestContext.logWithContext({
      action: 'UPDATE',
      entityType: 'User',
      entityId: userId,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      oldValue: {
        email: oldUser.email,
        name: oldUser.name,
        role: oldUser.role,
      },
      newValue: {
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updatedUser,
        updatedAt: updatedUser.updatedAt.toISOString(),
      },
      message: 'User role updated successfully',
    });
  } catch (error) {
    console.error('PATCH /api/users/[id]/role error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input data',
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
      { success: false, error: 'Failed to update user role' },
      { status: 500 },
    );
  }
}