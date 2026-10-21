'use client'

import { useEffect } from 'react'

/**
 * Injects a dynamic `@page` CSS rule while `active` is true.
 * Used by landscape print pages (A4 landscape is not reliably applied via
 * static named-page rules across browsers/print pipelines).
 */
export function usePageRule(active: boolean, rule: string) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return
    const el = document.createElement('style')
    el.setAttribute('data-dynamic-page-rule', 'true')
    el.textContent = `@media print { @page { ${rule} } }`
    document.head.appendChild(el)
    return () => {
      el.remove()
    }
  }, [active, rule])
}

/**
 * Runs `window.print()` with a temporary `@page` rule injected
 * (e.g. `printWithPageRule('size: A4 landscape; margin: 8mm;')`).
 */
export function printWithPageRule(rule: string) {
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.setAttribute('data-dynamic-page-rule', 'true')
  el.textContent = `@media print { @page { ${rule} } }`
  document.head.appendChild(el)
  try {
    window.print()
  } finally {
    // window.print() blocks in most browsers; remove shortly after
    setTimeout(() => el.remove(), 1000)
  }
}
