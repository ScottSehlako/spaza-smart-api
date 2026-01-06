export const metadata = {
  title: 'Spaza Smart API',
  description: 'Bookkeeping and Inventory System API',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}