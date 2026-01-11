import { z } from 'zod'

// Service validation - UPDATED with durationMinutes
export const createServiceSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(200),
  description: z.string().optional(),
  basePrice: z.number().positive('Base price must be positive'),
  durationMinutes: z.number().int().positive('Duration must be positive').optional(),
  isActive: z.boolean().default(true)
})

export const updateServiceSchema = createServiceSchema.partial()

// Service product (suggested usage)
export const serviceProductSchema = z.object({
  productId: z.string().cuid('Invalid product ID'),
  suggestedQuantity: z.number().positive('Suggested quantity must be greater than 0')
})

// Service execution
export const executeServiceSchema = z.object({
  appointmentId: z.string().cuid().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  actualUsage: z.array(
    z.object({
      productId: z.string().cuid('Invalid product ID'),
      quantityUsed: z.number().positive('Quantity used must be greater than 0')
    })
  ).min(0, 'Actual usage array required'),
  notes: z.string().optional()
})

// Query schemas
export const serviceQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional()
})