import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';

// Validation schema
const registerDeviceSchema = z.object({
  deviceToken: z.string().min(1, 'Device token is required'),
  platform: z.enum(['ios', 'android', 'web']).default('android'),
  deviceId: z.string().optional(),
  deviceModel: z.string().optional(),
});

// POST /api/notifications/register-device - Register device for push notifications
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    const body = await request.json();
    const { deviceToken, platform, deviceId, deviceModel } = registerDeviceSchema.parse(body);

    // Since you don't have NotificationDevice model in your schema,
    // we'll store this in a simple way or just acknowledge the registration
    
    // For now, we'll just return success since the model doesn't exist
    // In a real implementation, you'd create a NotificationDevice model
    
    return NextResponse.json(
      {
        success: true,
        data: {
          deviceToken: deviceToken.substring(0, 10) + '...', // Partial for security
          platform,
          deviceId,
          deviceModel,
          registeredAt: new Date().toISOString(),
        },
        message: 'Device registered for notifications',
        note: 'NotificationDevice model not implemented in database',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/notifications/register-device error:', error);

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
      { success: false, error: 'Failed to register device' },
      { status: 500 },
    );
  }
}