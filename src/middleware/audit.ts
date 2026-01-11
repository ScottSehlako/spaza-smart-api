// src/middleware/audit.ts
import { NextRequest, NextResponse } from 'next/server';
import { RequestContext } from '@/lib/request-context';

/**
 * Audit middleware for sensitive operations
 */
export async function auditMiddleware(
  request: NextRequest,
  response: NextResponse
) {
  // Skip non-mutative requests
  if (request.method === 'GET') {
    return response;
  }

  // Get session from headers or cookies
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) {
    return response;
  }

  try {
    // Map HTTP methods to audit actions
    const methodActionMap: Record<string, 'CREATE' | 'UPDATE' | 'DELETE'> = {
      'POST': 'CREATE',
      'PUT': 'UPDATE',
      'PATCH': 'UPDATE',
      'DELETE': 'DELETE',
    };

    const action = methodActionMap[request.method] || 'SYSTEM_ERROR';
    
    await RequestContext.logWithContext({
      action,
      entityType: 'API',
      entityId: request.nextUrl.pathname,
      performedById: 'system', // This will be overridden by RequestContext if user is logged in
      newValue: {
        path: request.nextUrl.pathname,
        method: request.method,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Don't block the request if audit logging fails
    console.error('Audit middleware error:', error);
  }

  return response;
}