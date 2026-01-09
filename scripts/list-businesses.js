#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function listBusinesses() {
  try {
    const businesses = await prisma.business.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    console.log('í¿¢ Businesses List\n')
    console.log('ID'.padEnd(30), '|', 'Name'.padEnd(20), '|', 'Type'.padEnd(15), '|', 'Created')
    console.log('-'.repeat(100))
    
    businesses.forEach(business => {
      console.log(
        business.id.padEnd(30), '|',
        business.name.padEnd(20), '|',
        business.type.padEnd(15), '|',
        business.createdAt.toISOString().split('T')[0]
      )
    })
    
    console.log(`\ní³Š Total: ${businesses.length} businesses`)
    
  } catch (error) {
    console.error('Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  listBusinesses()
}
