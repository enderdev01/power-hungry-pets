'use client';

import { useRouter } from 'next/navigation';
import { HomeInvitation } from '@/components/home-invitation';
import { getRoomFlowController } from '@/lib/room-flow/room-flow';

export default function HomePage() {
  const router = useRouter();
  return (
    <main className="home">
      <HomeInvitation
        controller={getRoomFlowController()}
        navigate={(to) => {
          router.push(to);
        }}
      />
    </main>
  );
}
