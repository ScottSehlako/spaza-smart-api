import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, generateToken, AuthError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RequestContext } from '@/lib/request-context';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 },
      );
    }

    const user = await prisma.user.findFirst({
      where: { email },
      include: { business: true },
    });

    if (!user) {
      // Log failed login attempt (without user context)
      try {
        await RequestContext.logWithContext({
          action: 'LOGIN_FAILED',
          entityType: 'System',
          entityId: 'auth_system',
          performedById: 'system',
          newValue: { email, reason: 'User not found' },
        });
      } catch (auditError) {
        console.warn('Failed to create audit log for failed login:', auditError);
      }

      throw new AuthError('Invalid credentials');
    }

    // Use proper password verification
    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      // Log failed login attempt
      try {
        await RequestContext.logWithContext({
          action: 'LOGIN_FAILED',
          entityType: 'User',
          entityId: user.id,
          businessId: user.businessId || undefined,
          performedById: user.id,
          newValue: { email, reason: 'Invalid password' },
        });
      } catch (auditError) {
        console.warn('Failed to create audit log for failed login:', auditError);
      }

      throw new AuthError('Invalid credentials');
    }

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate authentication token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId || undefined,
    });

    // Create audit log for successful login
    await RequestContext.logWithContext({
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      businessId: user.businessId || undefined,
      performedById: user.id,
      newValue: {
        email: user.email,
        role: user.role,
        businessName: user.business?.name,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
        businessName: user.business?.name,
        lastLoginAt: user.lastLoginAt?.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    console.error('Login error:', error);

    // Log system error
    try {
      await RequestContext.logWithContext({
        action: 'SYSTEM_ERROR',
        entityType: 'System',
        entityId: 'auth_system',
        performedById: 'system',
        newValue: {
          error: error instanceof Error ? error.message : 'Unknown error',
          endpoint: '/api/auth/login',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (auditError) {
      console.error('Failed to log system error:', auditError);
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * GET handler for login status check (optional)
 */
export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      message: 'Login endpoint',
      status: 'active',
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}