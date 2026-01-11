import { z } from 'zod'

// Appointment validation
export const createAppointmentSchema = z.object({
    serviceId: z.string().cuid('Invalid service ID'),
    clientName: z.string().min(1, 'Client name is required').max(200),
    clientPhone: z.string().optional(),
    scheduledDate: z.string().or(z.coerce.date()).transform((val) => new Date(val).toISOString()),
    durationMinutes: z.number().int().positive('Duration must be positive').optional(),
    assignedToId: z.string().cuid('Invalid employee ID').optional(),
    notes: z.string().optional()
  })
export const updateAppointmentSchema = createAppointmentSchema.partial().extend({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional()
})

// Appointment query schema
export const appointmentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  serviceId: z.string().cuid().optional(),
  assignedToId: z.string().cuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  showPast: z.coerce.boolean().default(false)
})