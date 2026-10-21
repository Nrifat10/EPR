'use client'

import { useCallback, useEffect, useState } from 'react'
import { ThemeProvider } from 'next-themes'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { AppSidebar } from '@/components/app/sidebar'
import { Topbar } from '@/components/app/topbar'
import { CommandPalette } from '@/components/app/command-palette'
import { AiChatPanel } from '@/components/app/ai/chat-panel'
import { LoginScreen } from '@/components/app/login-screen'
import { ViewRouter } from '@/components/app/views/registry'
import { api, setAuthToken } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import type { AppSettings, SessionUser } from '@/lib/types'

// Avoid hydration flash of the whole app shell
const LoginScreenLazy = dynamic(
  () => import('@/components/app/login-screen').then((m) => ({ default: m.LoginScreen })),
  { ssr: false }
)

export function App() {
  const { user, setUser, setSettings, view } = useAppStore()
  const [booting, setBooting] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      try {
        const [meRes, settingsRes] = await Promise.all([
          api.get<{ user: SessionUser | null }>('/api/auth/me').catch(() => ({ user: null })),
          api.get<{ settings: AppSettings }>('/api/settings').catch(() => null),
        ])
        if (cancelled) return
        if (meRes?.user) {
          setUser(meRes.user)
        } else {
          // No valid session — drop any stale bearer token (e.g. session was
          // destroyed server-side or expired) so we start clean.
          setAuthToken(null)
        }
        if (settingsRes?.settings) setSettings(settingsRes.settings)
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [setUser, setSettings])

  const handleLogout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout', {})
    } catch {
      // ignore
    }
    setAuthToken(null)
    setUser(null)
    toast.success('Signed out successfully')
  }, [setUser])

  if (booting) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 shrink-0 flex-col gap-3 border-r bg-sidebar p-4 md:flex">
          <Skeleton className="h-10 w-full bg-sidebar-accent" />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full bg-sidebar-accent/60" />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <LoginScreenLazy />
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <SidebarProvider>
        <AppSidebar onLogout={() => void handleLogout()} />
        <SidebarInset className="min-h-svh min-w-0">
          <Topbar onOpenPalette={() => setPaletteOpen(true)} />
          <div className="flex-1 space-y-4 p-4 pb-24 sm:space-y-6 sm:p-6 md:pb-10">
            {/* Smooth view-mount transition (subtle rise + fade) */}
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <ViewRouter />
            </motion.div>
          </div>
          <footer className="mt-auto border-t px-4 py-3 text-center text-xs text-muted-foreground sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            © {new Date().getFullYear()} {useAppStore.getState().settings.companyName} · Workforce,
            Payroll & Accounts System · All amounts in {useAppStore.getState().settings.currency}
          </footer>
        </SidebarInset>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <AiChatPanel />
      </SidebarProvider>
      <Toaster richColors position="top-right" />
    </ThemeProvider>
  )
}
