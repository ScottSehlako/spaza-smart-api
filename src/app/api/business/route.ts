// src/app/api/business/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Validation schemas
const createBusinessSchema = z.object({
  name: z.string().min(1, 'Business name is required'),
  type: z.enum(['PRODUCT_BASED', 'SERVICE_BASED', 'HYBRID']),
  address: z.string().optional(),
  phone: z.string().optional(),
  currency: z.string().default('ZAR'),
});

const updateBusinessSettingsSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  hasInventory: z.boolean().optional(),
  hasServices: z.boolean().optional(),
  hasAppointments: z.boolean().optional(),
});

// Helper function to check if user already owns a business
async function userOwnsBusiness(userId: string): Promise<boolean> {
  const existingBusiness = await prisma.business.findFirst({
    where: {
      users: {
        some: {
          id: userId,
          role: 'MANAGER',
        },
      },
    },
  });
  return !!existingBusiness;
}

// GET /api/business - Get business information
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(user);

    const business = await prisma.business.findUnique({
      where: {
        id: authUser.businessId!,
      },
      select: {
        id: true,
        name: true,
        type: true,
        address: true,
        phone: true,
        currency: true,
        timezone: true,
        hasInventory: true,
        hasServices: true,
        hasAppointments: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            products: true,
            services: true,
          },
        },
      },
    });

    if (!business) {
      return NextResponse.json(
        { success: false, error: 'Business not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...business,
        createdAt: business.createdAt.toISOString(),
        updatedAt: business.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('GET /api/business error:', error);

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

// POST /api/business - Create a new business
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user (doesn't need to have a business yet)
    const user = await getCurrentUserFromRequest(request);
    
    if (!user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    // Check if user already owns a business
    if (await userOwnsBusiness(user.id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'User already has a business. Managers can only have one business.',
        },
        { status: 400 },
      );
    }

    // Validate request body
    const body = await request.json();
    const validatedData = createBusinessSchema.parse(body);

    // Create the business
    const business = await prisma.business.create({
      data: {
        name: validatedData.name,
        type: validatedData.type,
        address: validatedData.address,
        phone: validatedData.phone,
        currency: validatedData.currency,
        timezone: 'Africa/Johannesburg',
        hasInventory: validatedData.type !== 'SERVICE_BASED',
        hasServices: validatedData.type !== 'PRODUCT_BASED',
        hasAppointments: validatedData.type === 'SERVICE_BASED' || validatedData.type === 'HYBRID',
        users: {
          connect: { id: user.id },
        },
      },
    });

    // Update user role to MANAGER and link to business
    await prisma.user.update({
      where: { id: user.id },
      data: {
        role: 'MANAGER',
        businessId: business.id,
      },
    });

    // Create audit log
    await RequestContext.logWithContext({
      action: 'CREATE',
      entityType: 'Business',
      entityId: business.id,
      businessId: business.id,
      performedById: user.id,
      newValue: {
        name: business.name,
        type: business.type,
        currency: business.currency,
        timezone: business.timezone,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          ...business,
          createdAt: business.createdAt.toISOString(),
          updatedAt: business.updatedAt.toISOString(),
        },
        message: 'Business created successfully',
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('POST /api/business error:', error);

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

    return NextResponse.json(
      { success: false, error: 'Failed to create business' },
      { status: 500 },
    );
  }
}

// PATCH /api/business - Update business settings
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(user);

    const body = await request.json();
    const validatedData = updateBusinessSettingsSchema.parse(body);

    // Get old values for audit log
    const oldBusiness = await prisma.business.findUnique({
      where: { id: authUser.businessId! },
      select: {
        name: true,
        address: true,
        phone: true,
        currency: true,
        timezone: true,
        hasInventory: true,
        hasServices: true,
        hasAppointments: true,
      },
    });

    const updatedBusiness = await prisma.business.update({
      where: { id: authUser.businessId! },
      data: validatedData,
    });

    // Create audit log
    if (Object.keys(validatedData).length > 0 && oldBusiness) {
      await RequestContext.logWithContext({
        action: 'UPDATE',
        entityType: 'Business',
        entityId: authUser.businessId!,
        businessId: authUser.businessId!,
        performedById: authUser.id,
        oldValue: oldBusiness,
        newValue: {
          name: updatedBusiness.name,
          address: updatedBusiness.address,
          phone: updatedBusiness.phone,
          currency: updatedBusiness.currency,
          timezone: updatedBusiness.timezone,
          hasInventory: updatedBusiness.hasInventory,
          hasServices: updatedBusiness.hasServices,
          hasAppointments: updatedBusiness.hasAppointments,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...updatedBusiness,
        createdAt: updatedBusiness.createdAt.toISOString(),
        updatedAt: updatedBusiness.updatedAt.toISOString(),
      },
      message: 'Business settings updated successfully',
    });
  } catch (error) {
    console.error('PATCH /api/business error:', error);

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
      { success: false, error: 'Failed to update business' },
      { status: 500 },
    );
  }
}