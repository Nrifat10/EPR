// Name List Excel export — streams an .xlsx of the list. Hidden columns (the
// per-list Columns setting) are NEVER included — client copies stay clean.
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { notFound, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import {
  defaultColumnsFor,
  formatSaudiMobile,
  nlFormatDate,
  nlOrderedColumns,
  parseListColumns,
} from '@/lib/name-list-utils'
import type { NameListColumns } from '@/lib/types'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({
      where: { id },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true } },
        subject: true,
        refInterviewList: { select: { listNo: true } },
        workers: {
          orderBy: { sortOrder: 'asc' },
          include: {
            staff: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                position: true,
                iqamaId: true,
                iqamaExpiry: true,
                passportNo: true,
                nationality: true,
                bloodGroup: true,
                experienceYears: true,
                staffCategory: { select: { name: true } },
              },
            },
          },
        },
      },
    })
    if (!list) return notFound('Name list not found')

    const kind = list.subject.kind === 'mobilization' ? 'mobilization' : 'interview'
    const isMob = kind === 'mobilization'

    // header meta — only ever shows VISIBLE data fields
    const aoa: (string | number | null)[][] = []
    aoa.push([`NAME LIST — ${list.subject.name.toUpperCase()}`])
    aoa.push([`List No: ${list.listNo}`])
    aoa.push([`Client: ${list.client?.name ?? ''}`])
    aoa.push([
      `Date: ${nlFormatDate(list.date)}${list.time ? `  Time: ${list.time}` : ''}`,
    ])
    if (isMob) {
      aoa.push([`Project / Site: ${list.project?.name ?? list.location ?? ''}`])
      const refs = [
        list.refInterviewList ? `Interview list ${list.refInterviewList.listNo}` : null,
        list.refPoNo ? `PO ${list.refPoNo}` : null,
      ].filter(Boolean)
      if (refs.length) aoa.push([`Reference: ${refs.join(' · ')}`])
    } else {
      aoa.push([`Location: ${list.location ?? ''}`])
      if (list.positions) {
        try {
          const p = JSON.parse(list.positions)
          if (Array.isArray(p) && p.length) aoa.push([`Positions: ${p.join(', ')}`])
        } catch {
          /* ignore */
        }
      }
    }
    if (list.clientContact || list.clientPhone) {
      aoa.push([
        `Client contact: ${list.clientContact ?? ''}${list.clientPhone ? ` · ${list.clientPhone}` : ''}`,
      ])
    }
    if (list.transport) aoa.push([`Transport: ${list.transport}`])
    aoa.push([null])

    // table header — # and Employee Name always; the rest honour the setting
    // (ordered per template kind, same as the print)
    const cols = nlOrderedColumns(kind, parseListColumns(list.columns) ?? defaultColumnsFor(kind))
    const header: string[] = ['#', 'Employee Name']
    for (const c of cols) header.push(c.key === 'experience' ? 'Exp. (yrs)' : c.label)
    aoa.push(header)

    const resultLabel: Record<string, string> = {
      selected: 'Selected',
      rejected: 'Rejected',
      absent: 'Absent',
      onhold: 'On hold',
    }

    for (let i = 0; i < list.workers.length; i++) {
      const w = list.workers[i]
      const row: (string | number | null)[] = [i + 1, w.staff.fullName]
      for (const c of cols) {
        switch (c.key) {
          case 'trade':
            row.push(w.staff.staffCategory?.name ?? w.staff.position ?? '')
            break
          case 'experience':
            row.push(w.staff.experienceYears ?? '')
            break
          case 'nationality':
            row.push(w.staff.nationality ?? '')
            break
          case 'iqama':
            row.push(w.staff.iqamaId)
            break
          case 'passport':
            row.push(w.staff.passportNo ?? '')
            break
          case 'mobile':
            row.push(w.staff.phone ? formatSaudiMobile(w.staff.phone) : '')
            break
          case 'blood':
            row.push(w.staff.bloodGroup ?? '')
            break
          case 'iqamaExpiry':
            row.push(w.staff.iqamaExpiry ? nlFormatDate(w.staff.iqamaExpiry) : '')
            break
          case 'employeeId':
            row.push(w.staff.id)
            break
          case 'result':
            row.push(w.result ? (resultLabel[w.result] ?? w.result) : '')
            break
          case 'remarks':
            row.push(w.remarks ?? '')
            break
        }
      }
      aoa.push(row)
    }

    // trade summary + total
    const trades = new Map<string, number>()
    for (const w of list.workers) {
      const t = w.staff.staffCategory?.name ?? w.staff.position ?? 'Uncategorized'
      trades.set(t, (trades.get(t) ?? 0) + 1)
    }
    aoa.push([null])
    aoa.push([[...trades.entries()].map(([t, n]) => `${t} ${n}`).join(' · ')])
    aoa.push([`Total ${list.workers.length} Workers`])
    aoa.push([null])
    aoa.push([`Status: ${list.status}`, '', `Prepared by: ${list.createdByName ?? ''}`])
    aoa.push(['This is a computer-generated name list.'])

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    const width = header.length
    const merges: XLSX.Range[] = []
    for (let r = 0; r < aoa.length; r++) {
      if (aoa[r].length === 1 && aoa[r][0] !== null) {
        merges.push({ s: { r, c: 0 }, e: { r, c: Math.max(width - 1, 1) } })
      }
    }
    sheet['!merges'] = merges
    sheet['!cols'] = header.map((h) => ({
      wch:
        h === '#'
          ? 4
          : h === 'Employee Name'
            ? 28
            : h === 'Remarks'
              ? 24
              : h === 'Employee ID'
                ? 26
                : h === 'Iqama No.' || h === 'Passport No.'
                  ? 16
                  : h === 'Mobile No.'
                    ? 15
                    : 14,
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Name List')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${list.listNo}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return serverError()
  }
}
