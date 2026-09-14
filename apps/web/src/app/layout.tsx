import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { DirectionContractComment } from '@/components/direction-contract';
import './globals.css';

export const metadata: Metadata = {
  title: 'Power Hungry Pets',
  description: 'Una mesa privada en línea para el juego de cartas Power Hungry Pets.',
};

/* Safe-area env() values resolve to 0 unless the page opts into
   viewport-fit=cover; this export is what makes the notched-phone insets in
   globals.css actually reserve space. */
export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
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
