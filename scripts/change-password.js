#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')
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

async function changePassword() {
  console.log('🔐 Change User Password\n')
  
  try {
    const email = await askQuestion('User email: ')
    const newPassword = await askQuestion('New password: ')
    const confirmPassword = await askQuestion('Confirm new password: ')
    
    if (newPassword !== confirmPassword) {
      throw new Error('Passwords do not match')
    }
    
    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters')
    }
    
    // Find user
    const user = await prisma.user.findFirst({
      where: { email }
    })
    
    if (!user) {
      throw new Error('User not found')
    }
    
    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10)
    
    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash }
    })
    
    console.log('\n✅ Password updated successfully!')
    console.log('User:', user.email)
    console.log('New password:', newPassword)
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
  } finally {
    rl.close()
    await prisma.$disconnect()
  }
}

changePassword()