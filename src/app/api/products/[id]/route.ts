// src/app/api/products/[id]/route.ts - UPDATED WITH REQUESTCONTEXT
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { updateProductSchema } from '@/lib/validations/product';
import {
  getCurrentUserFromRequest,
  requireManagerWithBusiness,
  requireBusinessAccess,
  AuthError,
} from '@/lib/api-auth';
import { RequestContext } from '@/lib/request-context'; // ADD THIS IMPORT

// Params schema for validation
const paramsSchema = z.object({
  id: z.string().cuid('Invalid product ID format'),
});

// GET /api/products/[id] - Get single product
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Authenticate user
    const user = await getCurrentUserFromRequest(request);
    const authUser = requireBusinessAccess(user);

    // 2. Get and validate product ID
    const { id: productId } = await params;
    const { id } = paramsSchema.parse({ id: productId });

    // 3. Fetch product with detailed information
    const product = await prisma.product.findUnique({
      where: {
        id: productId,
        businessId: authUser.businessId!, // Ensure business scoping
      },
      select: {
        id: true,
        name: true,
        description: true,
        sku: true,
        unitOfMeasure: true,
        quantity: true,
        reorderThreshold: true,
        optimalQuantity: true,
        costPerUnit: true,
        sellingPrice: true,
        isConsumable: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        barcode: {
          select: {
            code: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        // Include recent stock movements (last 10)
        stockMovements: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            quantity: true,
            previousQuantity: true,
            newQuantity: true,
            notes: true,
            createdAt: true,
            createdBy: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // 4. Format response
    const formattedProduct = {
      ...product,
      barcode: product.barcode?.code || null,
      createdBy: product.createdBy.name,
      stockMovements: product.stockMovements.map((movement) => ({
        ...movement,
        createdBy: movement.createdBy.name,
        createdAt: movement.createdAt.toISOString(),
      })),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };

    // 5. Return response
    return NextResponse.json({
      success: true,
      data: formattedProduct,
    });
  } catch (error) {
    console.error('GET /api/products/[id] error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid product ID', details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// PATCH /api/products/[id] - Update product
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Authenticate and authorize
    const user = await getCurrentUserFromRequest(request);
    const manager = requireManagerWithBusiness(user);

    // 2. Get and validate product ID
    const { id: productId } = await params;
    const { id } = paramsSchema.parse({ id: productId });

    // 3. Parse and validate request body
    const body = await request.json();
    const updateData = updateProductSchema.parse(body);

    // 4. Validate business logic
    if (
      updateData.sellingPrice !== undefined &&
      updateData.costPerUnit !== undefined &&
      updateData.sellingPrice <= updateData.costPerUnit
    ) {
      return NextResponse.json(
        { error: 'Selling price must be greater than cost price' },
        { status: 400 },
      );
    }

    // 5. Check if product exists and belongs to business
    const existingProduct = await prisma.product.findUnique({
      where: {
        id: productId,
        businessId: manager.businessId!,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        sellingPrice: true,
        costPerUnit: true,
        isActive: true,
      },
    });

    if (!existingProduct) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // 6. Check for name/SKU conflicts if being updated
    if (updateData.name || updateData.sku) {
      const whereClause: any = {
        businessId: manager.businessId!,
        id: { not: productId }, // Exclude current product
      };

      if (updateData.name) {
        whereClause.name = updateData.name;
      }
      if (updateData.sku) {
        whereClause.sku = updateData.sku;
      }

      const conflict = await prisma.product.findFirst({
        where: whereClause,
      });

      if (conflict) {
        return NextResponse.json(
          { error: 'Product with this name or SKU already exists' },
          { status: 400 },
        );
      }
    }

    // 7. Get old values for audit log BEFORE updating
    const oldProduct = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        description: true,
        sku: true,
        unitOfMeasure: true,
        costPerUnit: true,
        sellingPrice: true,
        reorderThreshold: true,
        optimalQuantity: true,
        isConsumable: true,
        isActive: true,
      },
    });

    // 8. Build update data
    const updatePayload: any = {
      ...updateData,
      updatedAt: new Date(),
    };

    // Handle barcode update if provided
    if (updateData.barcode !== undefined) {
      if (updateData.barcode) {
        // Upsert barcode (create or update)
        updatePayload.barcode = {
          upsert: {
            create: {
              code: updateData.barcode,
              businessId: manager.businessId!,
            },
            update: {
              code: updateData.barcode,
            },
          },
        };
      } else {
        // If barcode is empty string, delete it
        updatePayload.barcode = { delete: true };
      }
    }

    // 9. Update the product
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: updatePayload,
      select: {
        id: true,
        name: true,
        description: true,
        sku: true,
        unitOfMeasure: true,
        quantity: true,
        costPerUnit: true,
        sellingPrice: true,
        reorderThreshold: true,
        optimalQuantity: true,
        isConsumable: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        barcode: {
          select: { code: true },
        },
      },
    });

    // 10. Create audit log using RequestContext
    if (Object.keys(updateData).length > 0 && oldProduct) {
      await RequestContext.logWithContext({
        action: 'UPDATE',
        entityType: 'Product',
        entityId: productId,
        businessId: manager.businessId!,
        performedById: manager.id,
        oldValue: oldProduct,
        newValue: {
          name: updatedProduct.name,
          description: updatedProduct.description,
          sku: updatedProduct.sku,
          unitOfMeasure: updatedProduct.unitOfMeasure,
          costPerUnit: updatedProduct.costPerUnit,
          sellingPrice: updatedProduct.sellingPrice,
          reorderThreshold: updatedProduct.reorderThreshold,
          optimalQuantity: updatedProduct.optimalQuantity,
          isConsumable: updatedProduct.isConsumable,
          isActive: updatedProduct.isActive,
        },
      });
    }

    // 11. Return success response
    return NextResponse.json(
      {
        success: true,
        message: 'Product updated successfully',
        data: {
          ...updatedProduct,
          barcode: updatedProduct.barcode?.code || null,
          createdAt: updatedProduct.createdAt.toISOString(),
          updatedAt: updatedProduct.updatedAt.toISOString(),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('PATCH /api/products/[id] error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: 'Failed to update product' },
      { status: 500 },
    );
  }
}

// DELETE /api/products/[id] - Soft delete product
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Authenticate and authorize
    const user = await getCurrentUserFromRequest(request);
    const manager = requireManagerWithBusiness(user);

    // 2. Get and validate product ID
    const { id: productId } = await params;
    const { id } = paramsSchema.parse({ id: productId });

    // 3. Check if product exists and belongs to business
    const product = await prisma.product.findUnique({
      where: {
        id: productId,
        businessId: manager.businessId!,
      },
      select: {
        id: true,
        name: true,
        description: true,
        sku: true,
        unitOfMeasure: true,
        quantity: true,
        costPerUnit: true,
        sellingPrice: true,
        isConsumable: true,
        isActive: true,
      },
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // 4. Prevent deletion if product has stock
    if (product.quantity > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete product with stock remaining',
          currentStock: product.quantity,
        },
        { status: 400 },
      );
    }

    // 5. Check if product is already inactive
    if (!product.isActive) {
      return NextResponse.json(
        { error: 'Product is already inactive' },
        { status: 400 },
      );
    }

    // 6. Soft delete by setting isActive to false
    const deletedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // 7. Create audit log using RequestContext
    await RequestContext.logWithContext({
      action: 'DELETE',
      entityType: 'Product',
      entityId: productId,
      businessId: manager.businessId!,
      performedById: manager.id,
      oldValue: {
        name: product.name,
        description: product.description,
        sku: product.sku,
        unitOfMeasure: product.unitOfMeasure,
        costPerUnit: product.costPerUnit,
        sellingPrice: product.sellingPrice,
        isConsumable: product.isConsumable,
        isActive: true,
        quantity: product.quantity,
      },
      newValue: {
        name: deletedProduct.name,
        isActive: false,
        updatedAt: deletedProduct.updatedAt.toISOString(),
      },
    });

    // 8. Return success response
    return NextResponse.json({
      success: true,
      message: 'Product deactivated successfully',
      data: {
        id: deletedProduct.id,
        name: deletedProduct.name,
        isActive: deletedProduct.isActive,
        updatedAt: deletedProduct.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('DELETE /api/products/[id] error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid product ID', details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: 'Failed to delete product' },
      { status: 500 },
    );
  }
}