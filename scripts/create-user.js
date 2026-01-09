#!/usr/bin/env node

const { PrismaClient, UserRole } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const readline = require('readline')

const prisma = new PrismaClient()
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve))
}

async function listBusinesses() {
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' }
  })
  return businesses
}

async function createUser() {
  console.log('í¶• Create New User\n')
  
  try {
    // List available businesses
    const businesses = await listBusinesses()
    
    if (businesses.length === 0) {
      console.log('âš ï¸  No businesses found. Creating user without business association.')
    } else {
      console.log('í¿¢ Available Businesses:')
      businesses.forEach((biz, index) => {
        console.log(`  ${index + 1}. ${biz.name} (ID: ${biz.id})`)
      })
      console.log('')
    }
    
    // Get user input
    const email = await askQuestion('Email: ')
    const name = await askQuestion('Name: ')
    const role = await askQuestion('Role (MANAGER/EMPLOYEE/ACCOUNTANT): ')
    
    let businessId = ''
    if (businesses.length > 0) {
      businessId = await askQuestion(`Business ID (choose from above or press Enter to skip): `)
    } else {
      businessId = await askQuestion('Business ID (press Enter to skip): ')
    }
    
    const password = await askQuestion('Password: ')
    const confirmPassword = await askQuestion('Confirm Password: ')
    
    // Validate inputs
    if (!email.includes('@')) {
      throw new Error('Invalid email address')
    }
    
    const validRole = role.toUpperCase()
    if (!Object.values(UserRole).includes(validRole)) {
      throw new Error(`Invalid role. Must be one of: ${Object.values(UserRole).join(', ')}`)
    }
    
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match')
    }
    
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters')
    }
    
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: { email }
    })
    
    if (existingUser) {
      throw new Error('User with this email already exists')
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10)
    
    // Prepare user data
    const userData = {
      email,
      name,
      role: validRole,
      passwordHash
    }
    
    // Add businessId if provided
    if (businessId && businessId.trim() !== '') {
      // Check if business exists
      const business = await prisma.business.findUnique({
        where: { id: businessId.trim() }
      })
      
      if (!business) {
        throw new Error('Business not found with the provided ID. Use the exact ID from the list above.')
      }
      
      userData.businessId = businessId.trim()
    }
    
    // Create user
    const user = await prisma.user.create({
      data: userData
    })
    
    console.log('\nâœ… User created successfully!')
    console.log('ID:', user.id)
    console.log('Email:', user.email)
    console.log('Name:', user.name)
    console.log('Role:', user.role)
    console.log('Business ID:', user.businessId || 'None')
    console.log('\ní´ Login with:', email, '/', password)
    
  } catch (error) {
    console.error('\nâŒ Error:', error.message)
  } finally {
    rl.close()
    await prisma.$disconnect()
  }
}

// Run if called directly
if (require.main === module) {
  createUser()
}
