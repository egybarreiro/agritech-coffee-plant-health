import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AdminAnalysisReview } from '@/components/admin-analysis-review'
import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'
import { AgritechLogo } from '@/components/agritech-mark'

export default async function AdminAnalysesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=%2Fadmin%2Fanalyses')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'administrator') redirect('/dashboard')

  return (
    <main className="min-h-screen bg-[#f5f7f1]">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between border-b border-[#dfe5db] pb-5">
          <Link href="/admin" aria-label="AgriTech — administración">
            <AgritechLogo size={40} responsive />
            <span className="font-normal text-[#788477]">/ Revisión de fotografías</span>
          </Link>
          <SignOutButton />
        </header>
        <AdminAnalysisReview />
      </div>
    </main>
  )
}
