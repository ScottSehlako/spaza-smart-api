const axios = require('axios')

const API_URL = 'http://localhost:3000/api'

async function testAuth() {
  console.log('🔐 Testing Authentication System...\n')
  
  try {
    // 1. Test login with manager credentials
    console.log('1. Testing login...')
    const loginResponse = await axios.post(`${API_URL}/auth/login`, {
      email: 'manager@spazasmart.com',
      password: 'manager123'
    })
    
    console.log('✅ Login successful!')
    const token = loginResponse.data.token
    console.log(`Token: ${token.substring(0, 20)}...`)
    
    // 2. Test protected endpoint
    console.log('\n2. Testing protected endpoint...')
    const protectedResponse = await axios.get(`${API_URL}/protected`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    
    console.log('✅ Protected endpoint accessed!')
    console.log(`Users count: ${protectedResponse.data.users.length}`)
    
    // 3. Test user profile
    console.log('\n3. Testing user profile...')
    const profileResponse = await axios.get(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    
    console.log('✅ Profile retrieved!')
    console.log(`User: ${profileResponse.data.name} (${profileResponse.data.role})`)
    
    // 4. Test role-based access (try to invite user)
    console.log('\n4. Testing user invitation...')
    try {
      const inviteResponse = await axios.post(`${API_URL}/users/invite`, {
        email: 'newemployee@test.com',
        name: 'New Employee',
        role: 'EMPLOYEE',
        phone: '+27123456789'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      console.log('✅ User invitation successful!')
      console.log(`New user temporary password: ${inviteResponse.data.user.tempPassword}`)
    } catch (error) {
      console.log('❌ User invitation failed (might be expected if not manager):', error.response?.data?.error || error.message)
    }
    
    console.log('\n🎉 All authentication tests completed!')
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data?.error || error.message)
  }
}

testAuth()