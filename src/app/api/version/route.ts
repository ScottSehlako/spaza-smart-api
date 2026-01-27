import { NextRequest, NextResponse } from 'next/server';

// GET /api/version - Get API version information
export async function GET(request: NextRequest) {
  try {
    const versionInfo = {
      api: {
        version: process.env.API_VERSION || '1.0.0',
        name: 'Spaza Smart API',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      },
      system: {
        node: process.version,
        platform: process.platform,
        uptime: process.uptime(),
      },
      features: {
        authentication: true,
        inventory: true,
        sales: true,
        services: true,
        appointments: true,
        reporting: true,
        audit: true,
        notifications: true,
        barcode: true,
      },
      limits: {
        maxPageSize: 100,
        defaultPageSize: 50,
        maxBatchSize: 100,
      },
      documentation: {
        baseUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        swagger: '/api-docs', // If you add Swagger later
      },
    };

    return NextResponse.json({
      success: true,
      data: versionInfo,
    });
  } catch (error) {
    console.error('GET /api/version error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        version: '1.0.0',
      },
      { status: 500 },
    );
  }
}