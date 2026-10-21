"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Scroll container around every table. Toggles `data-fade-left` /
 * `data-fade-right` attributes while more content is available in that
 * direction — globals.css renders subtle edge gradients from them, telling
 * users (especially on mobile) the table keeps going. Fades are decoration
 * only (pointer-events none) and hidden in print.
 */
function TableContainer({ className, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)

  const update = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const overflow = el.scrollWidth - el.clientWidth
    if (overflow <= 1) {
      el.removeAttribute("data-fade-left")
      el.removeAttribute("data-fade-right")
      return
    }
    if (el.scrollLeft > 1) el.setAttribute("data-fade-left", "")
    else el.removeAttribute("data-fade-left")
    if (el.scrollLeft < overflow - 1) el.setAttribute("data-fade-right", "")
    else el.removeAttribute("data-fade-right")
  }, [])

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // the table inside is what actually grows/shrinks (columns, data loads)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [update])

  return (
    <div
      data-slot="table-container"
      ref={ref}
      onScroll={update}
      className={cn("scroll-x-fade relative w-full overflow-x-auto", className)}
      {...props}
    />
  )
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <TableContainer>
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </TableContainer>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
