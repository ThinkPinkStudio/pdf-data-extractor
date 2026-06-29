import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import Sidebar from '@/components/Sidebar'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.email) {
    redirect('/auth/login')
  }

  return (
    <div className="app-shell">
      <Sidebar email={session.email} />
      <main className="main-content">{children}</main>
    </div>
  )
}
