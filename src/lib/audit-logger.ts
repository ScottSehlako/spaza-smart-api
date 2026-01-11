// src/lib/audit-logger.ts
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// COMPLETE AuditAction type with ALL actions used in the system
type AuditAction =
  // CRUD Operations
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CREATE_FAILED'
  | 'UPDATE_FAILED'
  | 'DELETE_FAILED'

  // Authentication
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_INVITED'
  | 'USER_INVITATION_FAILED'
  | 'ROLE_CHANGED'

  // Stock Operations
  | 'STOCK_PURCHASE'
  | 'STOCK_SALE'
  | 'STOCK_SERVICE_USAGE'
  | 'STOCK_ADJUSTMENT'
  | 'STOCK_RETURN'
  | 'STOCK_MOVEMENT_FAILED'

  // Sales
  | 'SALE'
  | 'SALE_FAILED'

  // Services
  | 'SERVICE_COMPLETION'
  | 'SERVICE_COMPLETION_FAILED'

  // Appointments
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_CREATION_FAILED'
  | 'APPOINTMENT_UPDATED'
  | 'APPOINTMENT_UPDATE_FAILED'
  | 'APPOINTMENT_COMPLETED'
  | 'APPOINTMENT_COMPLETION_FAILED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_CANCELLATION_FAILED'
  | 'APPOINTMENT_STARTED'
  | 'APPOINTMENT_START_FAILED'

  // Products
  | 'PRODUCT_CREATED'
  | 'PRODUCT_CREATION_FAILED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_UPDATE_FAILED'
  | 'PRODUCT_DELETED'
  | 'PRODUCT_DELETION_FAILED'

  // System & Export
  | 'EXPORT'
  | 'EXPORT_FAILED'
  | 'SYSTEM_ERROR'
  | 'AUDIT_LOG_VIEWED'
  | 'AUDIT_LOG_EXPORTED';

interface AuditLogParams {
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
  businessId?: string;
  performedById: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLogger {
  /**
   * Convert value to proper Prisma Json format
   * Returns Prisma.JsonNull for null/undefined, otherwise JsonValue
   */
  private static toPrismaJson(value: any): Prisma.NullTypes.JsonNull | Prisma.JsonValue {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }
    try {
      // Convert to plain object that can be serialized
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      console.error('Failed to convert value to JSON:', error, value);
      // Return string representation if JSON conversion fails
      return String(value);
    }
  }

  /**
   * Log an audit event
   */
  // MINIMAL FIX - Just update the log() method
static async log(params: AuditLogParams): Promise<void> {
    try {
      const data: any = {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        businessId: params.businessId,
        performedById: params.performedById,
        ipAddress: params.ipAddress || '',
        userAgent: params.userAgent || '',
      };
  
      // Handle oldValue
      if (params.oldValue !== undefined && params.oldValue !== null) {
        data.oldValue = typeof params.oldValue === 'string' 
          ? params.oldValue 
          : JSON.stringify(params.oldValue);
      } else {
        data.oldValue = null;
      }
  
      // Handle newValue
      if (params.newValue !== undefined && params.newValue !== null) {
        data.newValue = typeof params.newValue === 'string'
          ? params.newValue
          : JSON.stringify(params.newValue);
      } else {
        data.newValue = null;
      }
  
      await prisma.auditLog.create({
        data,
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Helper methods for common operations
   */
  static async logCreate(
    entityType: string,
    entityId: string,
    newValue: any,
    businessId: string,
    performedById: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'CREATE',
      entityType,
      entityId,
      newValue,
      businessId,
      performedById,
      ipAddress,
      userAgent,
    });
  }

  static async logUpdate(
    entityType: string,
    entityId: string,
    oldValue: any,
    newValue: any,
    businessId: string,
    performedById: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'UPDATE',
      entityType,
      entityId,
      oldValue,
      newValue,
      businessId,
      performedById,
      ipAddress,
      userAgent,
    });
  }

  static async logDelete(
    entityType: string,
    entityId: string,
    oldValue: any,
    businessId: string,
    performedById: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'DELETE',
      entityType,
      entityId,
      oldValue,
      businessId,
      performedById,
      ipAddress,
      userAgent,
    });
  }

  static async logStockMovement(
    movementType: 'PURCHASE' | 'SALE' | 'SERVICE_USAGE' | 'ADJUSTMENT' | 'RETURN',
    productId: string,
    oldQuantity: number,
    newQuantity: number,
    businessId: string,
    performedById: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: `STOCK_${movementType}`,
      entityType: 'Product',
      entityId: productId,
      oldValue: { quantity: oldQuantity },
      newValue: { quantity: newQuantity },
      businessId,
      performedById,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Appointment-specific loggers
   */
  static async logAppointmentStart(
    appointmentId: string,
    clientName: string,
    serviceName: string,
    assignedTo: string | null,
    businessId: string,
    performedById: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'APPOINTMENT_STARTED',
      entityType: 'Appointment',
      entityId: appointmentId,
      oldValue: { status: 'SCHEDULED' },
      newValue: {
        status: 'IN_PROGRESS',
        clientName,
        serviceName,
        assignedTo: assignedTo || 'Unassigned',
        startedAt: new Date().toISOString(),
      },
      businessId,
      performedById,
      ipAddress,
      userAgent,
    });
  }

  static async logAppointmentStartFailed(
    appointmentId: string,
    error: string,
    businessId: string,
    performedById: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'APPOINTMENT_START_FAILED',
      entityType: 'Appointment',
      entityId: appointmentId,
      newValue: {
        error,
        timestamp: new Date().toISOString(),
      },
      businessId,
      performedById,
      ipAddress,
      userAgent,
    });
  }

  /**
   * System error logger
   */
  static async logSystemError(
    error: Error,
    endpoint: string,
    businessId?: string,
    performedById?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: 'SYSTEM_ERROR',
      entityType: 'System',
      entityId: 'system',
      newValue: {
        error: error.message,
        stack: error.stack,
        endpoint,
        timestamp: new Date().toISOString(),
      },
      businessId,
      performedById: performedById || 'system',
      ipAddress,
      userAgent,
    });
  }
}