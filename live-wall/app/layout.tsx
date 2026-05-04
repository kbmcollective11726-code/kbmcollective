export const metadata = { title: 'KBM Connect Wall', description: 'Event live wall' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: 'linear-gradient(180deg, #1a2332 0%, #151d28 55%, #121922 100%)',
          color: '#f8f9fa',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
