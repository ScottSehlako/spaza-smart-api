import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireBusinessAccess, AuthError } from '@/lib/api-auth';

// Business settings update schema
const settingsSchema = z.object({
  name: z.string().min(1, "Business name is required").max(100).optional(),
  address: z.string().max(200).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  currency: z.string().length(3, "Currency must be 3 characters (e.g., ZAR)").optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update",
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    // Only managers can update business settings
    if (authUser.role !== 'MANAGER') {
      return NextResponse.json(
        { success: false, error: 'Only managers can update business settings' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = settingsSchema.parse(body);

    // Prepare update data
    const updateData: any = { ...validatedData };
    
    // Convert empty strings to null for nullable fields
    if (updateData.address === '') updateData.address = null;
    if (updateData.phone === '') updateData.phone = null;

    // Update business
    const updatedBusiness = await prisma.business.update({
      where: { id: authUser.businessId! },
      data: updateData,
    });

    // Format response
    const responseData = {
      id: updatedBusiness.id,
      name: updatedBusiness.name,
      type: updatedBusiness.type,
      address: updatedBusiness.address,
      phone: updatedBusiness.phone,
      currency: updatedBusiness.currency,
      timezone: updatedBusiness.timezone,
      hasInventory: updatedBusiness.hasInventory,
      hasServices: updatedBusiness.hasServices,
      hasAppointments: updatedBusiness.hasAppointments,
      createdAt: updatedBusiness.createdAt.toISOString(),
      updatedAt: updatedBusiness.updatedAt.toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: responseData,
      message: 'Business settings updated successfully',
    });
  } catch (error) {
    console.error('PATCH /api/business/settings error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input data',
          details: error.issues,
        },
        { status: 400 }
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}