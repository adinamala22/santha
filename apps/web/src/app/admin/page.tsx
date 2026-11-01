import { redirect } from 'next/navigation';

// Live orders dashboard arrives in M6; until ops auth exists (M1) everything routes to sign-in.
export default function AdminHome() {
  redirect('/admin/login');
}
