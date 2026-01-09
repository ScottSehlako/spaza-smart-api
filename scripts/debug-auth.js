#!/usr/bin/env node

const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function debugAuth() {
  console.log('í´§ Debug Authentication\n')
  
  try {
    // 1. Check seeded users
    console.log('1. Checking seeded users...')
    const users = await prisma.user.findMany({
      select: {
        email: true,
        passwordHash: true,
        role: true,
        businessId: true
      }
    })
    
    console.log(`Found ${users.length} users:`)
    users.forEach(user => {
      console.log(`  - ${user.email} (${user.role})`)
      console.log(`    Password hash: ${user.passwordHash.substring(0, 30)}...`)
    })
    
    // 2. Test bcrypt with manager password
    console.log('\n2. Testing bcrypt with "manager123"...')
    const testHash = await bcrypt.hash('manager123', 10)
    console.log(`New hash: ${testHash.substring(0, 30)}...`)
    
    // 3. Compare with stored hash
    const manager = users.find(u => u.email === 'manager@spazasmart.com')
    if (manager) {
      console.log(`\n3. Comparing with stored hash...`)
      const isValid = await bcrypt.compare('manager123', manager.passwordHash)
      console.log(`Password "manager123" matches: ${isValid}`)
      
      if (!isValid) {
        console.log('âŒ BCRYPT MISMATCH! The hash in database might be wrong.')
        console.log('Try re-seeding with: npm run db:reset')
      } else {
        console.log('âœ… BCRYPT WORKS! Login should work.')
      }
    }
    
    // 4. List businesses
    console.log('\n4. Available businesses for user creation:')
    const businesses = await prisma.business.findMany()
    businesses.forEach(biz => {
      console.log(`  - ${biz.name}: ${biz.id}`)
    })
    
  } catch (error) {
    console.error('Debug error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  debugAuth()
}
