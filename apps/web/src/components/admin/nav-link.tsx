'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Sidebar link; highlighted when the current path is inside its section (mockup: "Live orders"). */
export function NavLink({ href, exact = false, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-md px-5 py-2.5 text-base s-focus ${active ? 'bg-white/10 font-medium text-white' : 'text-ondarkmuted hover:text-white'}`}
    >
      {children}
    </Link>
  );
}
