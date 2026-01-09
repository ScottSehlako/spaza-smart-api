const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function test() {
  console.log('Ì∑™ Testing Phase 1 Completion...\n')
  
  try {
    // Test 1: Can we connect?
    await prisma.$queryRaw`SELECT 1`
    console.log('‚úÖ 1. Database connection: OK')
    
    // Test 2: Count records
    const businessCount = await prisma.business.count()
    console.log(`‚úÖ 2. Businesses: ${businessCount}`)
    
    if (businessCount > 0) {
      // Test 3: Get business with relationships
      const business = await prisma.business.findFirst({
        include: {
          users: { take: 1 },
          products: { take: 1 },
          services: { take: 1 },
        }
      })
      
      console.log(`‚úÖ 3. Business "${business.name}" has:`)
      console.log(`   - Users: ${business.users.length}`)
      console.log(`   - Products: ${business.products.length}`)
      console.log(`   - Services: ${business.services.length}`)
      
      // Test 4: Check schema
      const hasUsers = await prisma.user.count() > 0
      const hasProducts = await prisma.product.count() > 0
      const hasServices = await prisma.service.count() > 0
      
      console.log(`‚úÖ 4. Schema validation:`)
      console.log(`   - Users table: ${hasUsers ? 'OK' : 'EMPTY'}`)
      console.log(`   - Products table: ${hasProducts ? 'OK' : 'EMPTY'}`)
      console.log(`   - Services table: ${hasServices ? 'OK' : 'EMPTY'}`)
    }
    
    console.log('\nÌæâ Phase 1 testing complete!')
    
  } catch (error) {
    console.error('‚ùå Test failed:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

test()
