'use client';

import { Suspense } from 'react';
import WallPageContent from './WallPageContent';

export default function WallPage() {
  return (
    <Suspense fallback={<div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}>
      <WallPageContent />
    </Suspense>
  );
}
