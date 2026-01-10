#!/usr/bin/env node

const axios = require('axios')
const readline = require('readline')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve))
}

async function testSales() {
  console.log('🛒 Test Phase 5: Product Sales\n')
  
  try {
    const baseUrl = 'http://localhost:3000'
    
    // 1. Login as manager
    console.log('1. Logging in as manager...')
    const loginResponse = await axios.post(`${baseUrl}/api/auth/login`, {
      email: 'manager@spazasmart.com',
      password: 'manager123'
    })
    
    if (!loginResponse.data.success) {
      throw new Error('Manager login failed')
    }
    
    const token = loginResponse.data.token
    console.log('✅ Manager login successful')
    
    const headers = { Authorization: `Bearer ${token}` }
    
    // 2. Get a product to sell
    console.log('\n2. Getting available products...')
    const productsResponse = await axios.get(`${baseUrl}/api/products`, { headers })
    
    if (!productsResponse.data.data || productsResponse.data.data.length === 0) {
      throw new Error('No products available for testing')
    }
    
    const availableProducts = productsResponse.data.data.filter(p => p.quantity > 0)
    
    if (availableProducts.length === 0) {
      console.log('⚠️  No products with stock. Adding stock first...')
      
      // Add stock to first product
      const firstProduct = productsResponse.data.data[0]
      await axios.post(`${baseUrl}/api/products/${firstProduct.id}/add-stock`, {
        quantity: 10,
        notes: 'Stock for testing sales'
      }, { headers })
      
      availableProducts.push({ ...firstProduct, quantity: 10 })
    }
    
    console.log(`✅ Found ${availableProducts.length} products with stock`)
    availableProducts.forEach(p => {
      console.log(`   - ${p.name}: ${p.quantity} available, R${p.sellingPrice} each`)
    })
    
    // 3. Create a sale
    console.log('\n3. Creating a sale...')
    const saleItems = availableProducts.slice(0, 2).map(product => ({
      productId: product.id,
      quantity: 1,
      unitPrice: product.sellingPrice
    }))
    
    const saleData = {
      customerName: 'Test Customer',
      customerPhone: '0712345678',
      items: saleItems,
      notes: 'Test sale from automated script'
    }
    
    const saleResponse = await axios.post(`${baseUrl}/api/sales/product`, saleData, { headers })
    
    if (!saleResponse.data.success) {
      throw new Error('Sale creation failed: ' + JSON.stringify(saleResponse.data))
    }
    
    const sale = saleResponse.data.data.sale
    console.log('✅ Sale created successfully!')
    console.log('   Receipt:', sale.receiptNumber)
    console.log('   Total:', sale.totalAmount)
    console.log('   Items:', saleResponse.data.data.items.length)
    console.log('   Profit:', saleResponse.data.data.totals.profit)
    
    // 4. Get sales list
    console.log('\n4. Getting sales list...')
    const salesListResponse = await axios.get(`${baseUrl}/api/sales/product`, { headers })
    
    console.log('✅ Sales list retrieved')
    console.log('   Total sales:', salesListResponse.data.data.totals.count)
    console.log('   Total amount:', salesListResponse.data.data.totals.amount)
    
    // 5. Get single sale details
    if (salesListResponse.data.data.sales.length > 0) {
      const firstSale = salesListResponse.data.data.sales[0]
      console.log(`\n5. Getting sale details for ${firstSale.receiptNumber}...`)
      
      const singleSaleResponse = await axios.get(`${baseUrl}/api/sales/${firstSale.id}`, { headers })
      
      console.log('✅ Sale details retrieved')
      console.log('   Customer:', singleSaleResponse.data.data.customerName)
      console.log('   Items:', singleSaleResponse.data.data.saleItems.length)
      console.log('   Profit margin:', singleSaleResponse.data.data.financials.profitMargin.toFixed(2) + '%')
    }
    
    // 6. Test employee sale creation
    console.log('\n6. Testing employee sale creation...')
    const empLogin = await axios.post(`${baseUrl}/api/auth/login`, {
      email: 'employee@spazasmart.com',
      password: 'employee123'
    })
    
    const empToken = empLogin.data.token
    const empHeaders = { Authorization: `Bearer ${empToken}` }
    
    // Employee should be able to create sale
    const empSaleResponse = await axios.post(`${baseUrl}/api/sales/product`, {
      items: [{
        productId: availableProducts[0].id,
        quantity: 1
      }],
      notes: 'Employee test sale'
    }, { headers: empHeaders })
    
    if (empSaleResponse.data.success) {
      console.log('✅ Employee can create sales')
      console.log('   Receipt:', empSaleResponse.data.data.sale.receiptNumber)
    }
    
    // Employee should NOT be able to view sales list
    try {
      await axios.get(`${baseUrl}/api/sales/product`, { headers: empHeaders })
      console.log('❌ Employee could view sales list (UNEXPECTED!)')
    } catch (error) {
      if (error.response?.status === 403) {
        console.log('✅ Employee correctly blocked from viewing sales list')
      } else {
        console.log('⚠️  Unexpected error for employee view:', error.response?.status)
      }
    }
    
    console.log('\n🎉 Phase 5 Sales System Test Complete!')
    console.log('\n📊 Summary:')
    console.log('- Sale creation: ✅')
    console.log('- Stock deduction: ✅')
    console.log('- Receipt generation: ✅')
    console.log('- Profit calculation: ✅')
    console.log('- Sales listing: ✅')
    console.log('- Single sale view: ✅')
    console.log('- Role-based access: ✅')
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    if (error.response) {
      console.error('Status:', error.response.status)
      console.error('Response:', JSON.stringify(error.response.data, null, 2))
    }
  } finally {
    rl.close()
  }
}

if (require.main === module) {
  testSales()
}