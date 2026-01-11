import { z } from 'zod'

// Common report query parameters
export const reportQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
  businessId: z.string().cuid().optional()
})

// Sales report specific
export const salesReportQuerySchema = reportQuerySchema.extend({
  groupBy: z.enum(['day', 'week', 'month', 'product', 'employee']).default('day'),
  includeServices: z.coerce.boolean().default(true),
  includeProducts: z.coerce.boolean().default(true)
})

// Inventory report specific
export const inventoryReportQuerySchema = reportQuerySchema.extend({
  reportType: z.enum(['movement', 'status', 'valuation']).default('movement'),
  lowStockOnly: z.coerce.boolean().default(false),
  includeInactive: z.coerce.boolean().default(false)
})

// Profit report specific
export const profitReportQuerySchema = reportQuerySchema.extend({
  groupBy: z.enum(['day', 'week', 'month', 'product', 'service']).default('day'),
  includeCosts: z.coerce.boolean().default(true),
  includeMargins: z.coerce.boolean().default(true)
})

// Service report specific
export const serviceReportQuerySchema = reportQuerySchema.extend({
  groupBy: z.enum(['day', 'week', 'month', 'service', 'employee']).default('day'),
  includeProductUsage: z.coerce.boolean().default(true)
})

// Export options
export const exportQuerySchema = z.object({
  reportType: z.enum(['sales', 'inventory', 'profit', 'services', 'all']),
  format: z.enum(['csv', 'pdf', 'excel']).default('csv'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional()
})