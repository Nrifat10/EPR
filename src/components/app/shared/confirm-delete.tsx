'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ConfirmDelete({
  onConfirm,
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  label,
  size = 'icon',
  triggerClassName,
}: {
  onConfirm: () => Promise<void> | void
  title?: string
  description?: string
  label?: string
  size?: 'icon' | 'sm' | 'default'
  /** Extra classes for the trigger button (e.g. larger mobile touch targets) */
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    try {
      setLoading(true)
      await onConfirm()
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {label ? (
          <Button variant="destructive" size={size} className="h-9">
            <Trash2 className="h-4 w-4" />
            {label}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive', triggerClassName)}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
