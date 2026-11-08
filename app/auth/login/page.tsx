import { LoginForm } from '@/components/login-form'

type LoginPageProps = {
  searchParams: Promise<{ error?: string; redirectTo?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams
  return <LoginForm callbackError={error ?? null} />
}
