#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function listUsers() {
  try {
    const users = await prisma.user.findMany({
      include: {
        business: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    console.log('👥 Users List\n')
    console.log('ID | Email | Name | Role | Business | Created')
    console.log('---|-------|------|------|----------|--------')
    
    users.forEach(user => {
      console.log(
        `${user.id.slice(0, 8)}... | ${user.email} | ${user.name} | ${user.role} | ${user.business?.name || 'N/A'} | ${user.createdAt.toISOString().split('T')[0]}`
      )
    })
    
    console.log(`\n📊 Total: ${users.length} users`)
    
  } catch (error) {
    console.error('Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

listUsers()