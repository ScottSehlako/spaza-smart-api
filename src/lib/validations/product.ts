// src/lib/validations/product.ts
import { z } from 'zod'
import { UnitOfMeasure } from '@prisma/client'

export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  description: z.string().optional(),
  sku: z.string().optional(),
  unitOfMeasure: z.nativeEnum(UnitOfMeasure),
  costPerUnit: z.number().positive('Cost must be positive'),
  sellingPrice: z.number().positive('Price must be positive'),
  reorderThreshold: z.number().nonnegative().optional(),
  optimalQuantity: z.number().positive().optional(),
  isConsumable: z.boolean().default(true),
  barcode: z.string().optional()
})

export const updateProductSchema = createProductSchema.partial()

export const addStockSchema = z.object({
  quantity: z.number().positive('Quantity must be greater than 0'),
  notes: z.string().optional()
})

export const adjustStockSchema = z.object({
  quantity: z.number().refine(value => value !== 0, { message: 'Quantity cannot be zero' }),
  reason: z.string().min(1, 'Reason is required for adjustments')
})

export const setReorderSchema = z.object({
  reorderThreshold: z.number().nonnegative('Reorder threshold cannot be negative').optional(),
  optimalQuantity: z.number().positive('Optimal quantity must be positive').optional()
})

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  lowStockOnly: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().optional(),
  unitOfMeasure: z.nativeEnum(UnitOfMeasure).optional()
})