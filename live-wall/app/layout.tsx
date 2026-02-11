export const metadata = { title: 'CollectiveLive Wall', description: 'Event live wall' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#1e0a2e', color: '#ffffff' }}>
        {children}
      </body>
    </html>
  );
}
