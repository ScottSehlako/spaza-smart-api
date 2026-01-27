import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Validation schema - FIXED z.record() usage
const sendNotificationSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  type: z.enum(['LOW_STOCK', 'APPOINTMENT_REMINDER', 'SALE_ALERT', 'SYSTEM', 'CUSTOM']).default('CUSTOM'),
  targetUserId: z.string().cuid('Invalid user ID').optional(),
  data: z.record(z.string(), z.any()).optional(), // FIXED: Added key type
});

// POST /api/notifications/send - Send notification to users
export async function POST(request: NextRequest) {
  try {
    const manager = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(manager);

    const requestBody = await request.json();
    const { title, body, type, targetUserId, data } = sendNotificationSchema.parse(requestBody);

    let targetUsers: Array<{ id: string; name: string; email: string }> = [];

    if (targetUserId) {
      // Send to specific user
      const targetUser = await prisma.user.findFirst({
        where: {
          id: targetUserId,
          businessId: authUser.businessId!,
        },
        select: { id: true, name: true, email: true },
      });

      if (!targetUser) {
        return NextResponse.json(
          { success: false, error: 'Target user not found' },
          { status: 404 },
        );
      }

      targetUsers = [targetUser];
    } else {
      // Send to all users in business (except manager)
      const allUsers = await prisma.user.findMany({
        where: {
          businessId: authUser.businessId!,
        },
        select: { id: true, name: true, email: true },
      });

      targetUsers = allUsers.filter((user) => user.id !== authUser.id);
    }

    // Create audit log - Use standard CREATE action
    await RequestContext.logWithContext({
      action: 'CREATE',
      entityType: 'Notification',
      entityId: `notification-${Date.now()}`,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      newValue: {
        title,
        body,
        type,
        targetCount: targetUsers.length,
        targetType: targetUserId ? 'single' : 'all',
        targetUsers: targetUsers.map(user => ({
          id: user.id,
          name: user.name,
        })),
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          sentCount: targetUsers.length,
          notifications: targetUsers.map((user) => ({
            userId: user.id,
            userName: user.name,
            title,
            body,
            type,
            status: 'SIMULATED_SENT',
            timestamp: new Date().toISOString(),
          })),
        },
        message: `Notification would be sent to ${targetUsers.length} user(s)`,
        note: 'Notification system not fully implemented - missing Notification model',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/notifications/send error:', error);

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
      { success: false, error: 'Failed to send notification' },
      { status: 500 },
    );
  }
}