import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, requireManagerWithBusiness, AuthError } from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context';

// Validation schema
const registerBarcodeSchema = z.object({
  productId: z.string().cuid('Invalid product ID'),
  barcode: z.string().min(1, 'Barcode is required'),
});

// POST /api/barcodes/register - Register or update barcode for a product
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireManagerWithBusiness(user);

    const body = await request.json();
    const { productId, barcode } = registerBarcodeSchema.parse(body);

    // Check if product exists and belongs to business
    const product = await prisma.product.findUnique({
      where: {
        id: productId,
        businessId: authUser.businessId!,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: {
          select: {
            id: true,
            code: true,
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: 'Product not found or inactive' },
        { status: 404 },
      );
    }

    // Check if barcode is already in use (barcode.code is unique across all businesses)
    const existingBarcode = await prisma.barcode.findFirst({
      where: {
        code: barcode,
      },
    });

    if (existingBarcode) {
      return NextResponse.json(
        {
          success: false,
          error: 'Barcode already in use',
        },
        { status: 400 },
      );
    }

    // Get old barcode for audit log
    const oldBarcode = product.barcode?.code || null;

    // Handle barcode creation/update
    let barcodeRecord;
    let isUpdate = false;
    
    if (product.barcode) {
      isUpdate = true;
      // Update existing barcode (delete old, create new due to unique constraint)
      await prisma.barcode.delete({
        where: { id: product.barcode.id },
      });
      
      barcodeRecord = await prisma.barcode.create({
        data: {
          code: barcode,
          productId,
          businessId: authUser.businessId!,
        },
        select: {
          id: true,
          code: true,
          productId: true,
        },
      });
    } else {
      // Create new barcode
      barcodeRecord = await prisma.barcode.create({
        data: {
          code: barcode,
          productId,
          businessId: authUser.businessId!,
        },
        select: {
          id: true,
          code: true,
          productId: true,
        },
      });
    }

    // Create audit log - Use UPDATE or CREATE action based on your AuditAction enum
    await RequestContext.logWithContext({
      action: isUpdate ? 'UPDATE' : 'CREATE', // Use standard audit actions
      entityType: 'Product',
      entityId: productId,
      businessId: authUser.businessId!,
      performedById: authUser.id,
      oldValue: {
        barcode: oldBarcode,
        productName: product.name,
        sku: product.sku,
      },
      newValue: {
        barcode: barcodeRecord.code,
        productName: product.name,
        sku: product.sku,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          ...barcodeRecord,
          productName: product.name,
          sku: product.sku,
        },
        message: isUpdate
          ? 'Barcode updated successfully'
          : 'Barcode registered successfully',
      },
      { status: isUpdate ? 200 : 201 },
    );
  } catch (error) {
    console.error('POST /api/barcodes/register error:', error);

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
      { success: false, error: 'Failed to register barcode' },
      { status: 500 },
    );
  }
}