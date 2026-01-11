// src/lib/request-context.ts
import { headers } from 'next/headers';
import { AuditLogger } from './audit-logger';

export class RequestContext {
  /**
   * Get client IP address from request
   */
  static async getClientIp(): Promise<string> {
    try {
      const headersList = await headers();
      const forwardedFor = headersList.get('x-forwarded-for');
      
      if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
      }
      
      return headersList.get('x-real-ip') || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get user agent from request
   */
  static async getUserAgent(): Promise<string> {
    try {
      const headersList = await headers();
      return headersList.get('user-agent') || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Log an audit event with request context
   */
  static async logWithContext(
    params: Omit<Parameters<typeof AuditLogger.log>[0], 'ipAddress' | 'userAgent'>
  ): Promise<void> {
    try {
      const [ipAddress, userAgent] = await Promise.all([
        this.getClientIp(),
        this.getUserAgent(),
      ]);

      await AuditLogger.log({
        ...params,
        ipAddress,
        userAgent,
      });
    } catch (error) {
      console.error('Failed to log with request context:', error);
      // Fall back to basic logging without context
      try {
        await AuditLogger.log({
          ...params,
          ipAddress: 'unknown',
          userAgent: 'unknown',
        });
      } catch (fallbackError) {
        console.error('Failed to create fallback audit log:', fallbackError);
      }
    }
  }
}