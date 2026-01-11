// src/app/api/audit-logs/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/api-auth';

/**
 * GET /api/audit-logs/export
 * Export audit logs as CSV
 * Access: Manager & Accountant only
 */
export async function GET(request: NextRequest) {
  try {
    // Use getCurrentUserFromRequest instead of getSession
    const user = await getCurrentUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check role - only managers and accountants can export
    if (user.role !== 'MANAGER' && user.role !== 'ACCOUNTANT') {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Ensure user has business access
    if (!user.businessId) {
      return NextResponse.json(
        { error: 'User does not have business access' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = {
      businessId: user.businessId,
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const auditLogs = await prisma.auditLog.findMany({
      where,
      include: {
        performedBy: {
          select: {
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10000, // Limit exports
    });

    // Convert to CSV format with proper null handling
    const csvHeaders = [
      'Timestamp',
      'Action',
      'Entity Type',
      'Entity ID',
      'Performed By',
      'User Email',
      'User Role',
      'IP Address',
      'Old Value',
      'New Value',
    ];

    const csvRows = auditLogs.map(log => {
      // Safely handle null values
      const performedByName = log.performedBy?.name || 'Unknown';
      const performedByEmail = log.performedBy?.email || 'Unknown';
      const performedByRole = log.performedBy?.role || 'Unknown';
      
      const row = [
        log.createdAt.toISOString(),
        log.action,
        log.entityType,
        log.entityId,
        performedByName,
        performedByEmail,
        performedByRole,
        log.ipAddress || '',
        log.oldValue ? JSON.stringify(log.oldValue) : '',
        log.newValue ? JSON.stringify(log.newValue) : '',
      ];
      
      // Escape CSV special characters with proper null checking
      return row.map(cell => {
        // Convert cell to string and handle null/undefined
        const cellString = cell?.toString() || '';
        
        // Escape CSV special characters
        if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
          return `"${cellString.replace(/"/g, '""')}"`;
        }
        return cellString;
      }).join(',');
    });

    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');

    // Return as downloadable file
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Failed to export audit logs:', error);
    return NextResponse.json(
      { error: 'Failed to export audit logs' },
      { status: 500 }
    );
  }
}