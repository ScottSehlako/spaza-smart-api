import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Params validation schema
const paramsSchema = z.object({
  id: z.string().cuid('Invalid user ID format'),
});

// DELETE /api/users/[id] - Remove user from business
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const manager = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(manager);

    const { id: userId } = await params;
    const { id } = paramsSchema.parse({ id: userId });

    // Prevent self-deletion
    if (userId === authUser.id) {
      return NextResponse.json(
        {
          success: false,
          error: 'You cannot remove yourself from the business',
        },
        { status: 400 },
      );
    }

    // Get user details for audit log
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        businessId: authUser.businessId!,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found in your business' },
        { status: 404 },
      );
    }

    // Remove user from business (set businessId to null)
    const deletedUser = await prisma.user.update({
      where: {
        id: userId,
        businessId: authUser.businessId!,
      },
      data: {
        businessId: null,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        businessId: true,
        updatedAt: true,
      },
    });

    // Create audit log - Use standard DELETE action
    await RequestContext.logWithContext({
      action: 'DELETE',
      entityType: 'User',
      entityId: userId,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      oldValue: {
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: authUser.businessId,
      },
      newValue: {
        email: deletedUser.email,
        name: deletedUser.name,
        businessId: null,
        updatedAt: deletedUser.updatedAt.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: deletedUser.id,
        email: deletedUser.email,
        name: deletedUser.name,
        businessId: deletedUser.businessId,
        updatedAt: deletedUser.updatedAt.toISOString(),
      },
      message: 'User removed from business successfully',
    });
  } catch (error) {
    console.error('DELETE /api/users/[id] error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid user ID',
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
      { success: false, error: 'Failed to remove user' },
      { status: 500 },
    );
  }
}