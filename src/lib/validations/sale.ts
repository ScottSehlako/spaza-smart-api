import { z } from 'zod'

// Sale item schema
export const saleItemSchema = z.object({
  productId: z.string().cuid('Invalid product ID'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unitPrice: z.number().positive('Unit price must be positive').optional()
})

// Create sale schema
export const createSaleSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  items: z.array(saleItemSchema).min(1, 'At least one item is required'),
  notes: z.string().optional()
})

// Sale query schema (for listing)
export const saleQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional()
})