import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DirectionContractComment } from '@/components/direction-contract';
import './globals.css';

export const metadata: Metadata = {
  title: 'Power Hungry Pets',
  description: 'A private online table for the Power Hungry Pets card game.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Approved direction contract (seed 9719d81e), placed as a real body
            comment at hydration; see direction-contract.tsx for the precise
            Next/React constraint. */}
        <DirectionContractComment />
        {children}
      </body>
    </html>
  );
}
