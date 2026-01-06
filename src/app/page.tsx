export default function Home() {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        <h1>Spaza Smart API</h1>
        <p>Backend API for bookkeeping and inventory system</p>
        <ul>
          <li><a href="/api/health">/api/health</a> - Health check</li>
          <li><a href="/api/auth/login">/api/auth/login</a> - User login</li>
          <li><a href="/api/auth/me">/api/auth/me</a> - User profile (requires auth)</li>
          <li><a href="/api/protected">/api/protected</a> - Protected endpoint (requires auth)</li>
        </ul>
      </div>
    )
  }