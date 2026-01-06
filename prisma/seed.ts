import { PrismaClient, UserRole, BusinessType, UnitOfMeasure } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')
  
  // Clear existing data
  await prisma.auditLog.deleteMany()
  await prisma.stockMovement.deleteMany()
  await prisma.productUsage.deleteMany()
  await prisma.saleItem.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.serviceSale.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.serviceProduct.deleteMany()
  await prisma.barcode.deleteMany()
  await prisma.product.deleteMany()
  await prisma.service.deleteMany()
  await prisma.user.deleteMany()
  await prisma.business.deleteMany()

  // Create business
  const business = await prisma.business.create({
    data: {
      name: 'Sample Spaza Shop',
      type: BusinessType.HYBRID,
      phone: '+27123456789',
      address: '123 Main Street',
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg',
      hasInventory: true,
      hasServices: true,
    },
  })

  // Create users with plain passwords (will hash in Phase 2)
  const manager = await prisma.user.create({
    data: {
      email: 'manager@spazasmart.com',
      name: 'Shop Manager',
      passwordHash: 'temp_hash_manager', // Temporary
      role: UserRole.MANAGER,
      businessId: business.id,
    },
  })

  const employee = await prisma.user.create({
    data: {
      email: 'employee@spazasmart.com',
      name: 'Shop Assistant',
      passwordHash: 'temp_hash_employee',
      role: UserRole.EMPLOYEE,
      businessId: business.id,
      invitedById: manager.id,
    },
  })

  const accountant = await prisma.user.create({
    data: {
      email: 'accountant@spazasmart.com',
      name: 'Business Accountant',
      passwordHash: 'temp_hash_accountant',
      role: UserRole.ACCOUNTANT,
      businessId: business.id,
      invitedById: manager.id,
    },
  })

  // Create products
  const product1 = await prisma.product.create({
    data: {
      name: 'Coca-Cola 500ml',
      description: 'Carbonated soft drink',
      unitOfMeasure: UnitOfMeasure.PIECE,
      quantity: 100,
      costPerUnit: 8.50,
      sellingPrice: 15.00,
      isConsumable: true,
      businessId: business.id,
      createdById: manager.id,
    },
  })

  // Create barcode
  await prisma.barcode.create({
    data: {
      code: '123456789012',
      productId: product1.id,
      businessId: business.id,
    },
  })

  // Create service
  await prisma.service.create({
    data: {
      name: 'Haircut',
      description: 'Basic haircut service',
      basePrice: 120.00,
      isActive: true,
      businessId: business.id,
      createdById: manager.id,
    },
  })

  console.log('✅ Seed completed!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())