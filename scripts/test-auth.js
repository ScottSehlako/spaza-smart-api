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

async function testAuth() {
  console.log('🔐 Test Authentication\n')
  
  try {
    const baseUrl = 'http://localhost:3000'
    
    // Get credentials
    const email = await askQuestion('Email: ')
    const password = await askQuestion('Password: ')
    
    console.log('\n🔑 Attempting login...')
    
    // 1. Login
    const loginResponse = await axios.post(`${baseUrl}/api/auth/login`, {
      email,
      password
    })
    
    if (!loginResponse.data.success) {
      throw new Error('Login failed: ' + loginResponse.data.error)
    }
    
    const token = loginResponse.data.token
    console.log('✅ Login successful!')
    console.log('Token:', token.slice(0, 30) + '...')
    console.log('User:', loginResponse.data.user)
    
    // 2. Test /api/auth/me
    console.log('\n👤 Testing /api/auth/me...')
    const meResponse = await axios.get(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    
    console.log('✅ /api/auth/me successful:', meResponse.data)
    
    // 3. Test products endpoint
    console.log('\n📦 Testing /api/products...')
    const productsResponse = await axios.get(`${baseUrl}/api/products`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    
    console.log('✅ /api/products successful')
    console.log('Products found:', productsResponse.data.data?.length || 0)
    
    // 4. If there are products, test single product
    if (productsResponse.data.data && productsResponse.data.data.length > 0) {
      const firstProduct = productsResponse.data.data[0]
      console.log(`\n📋 Testing /api/products/${firstProduct.id}...`)
      
      const singleProductResponse = await axios.get(`${baseUrl}/api/products/${firstProduct.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      console.log('✅ Single product successful')
      console.log('Product name:', singleProductResponse.data.data?.name)
    }
    
    console.log('\n🎉 All authentication tests passed!')
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    if (error.response) {
      console.error('Response status:', error.response.status)
      console.error('Response data:', error.response.data)
    }
  } finally {
    rl.close()
  }
}

// Run if called directly
if (require.main === module) {
  testAuth()
}