'use client'

// Name List module shell — four tabs:
//   • Lists      — worker deployment lists (interviews, trade tests, medicals,
//                  mobilization, demobilization) with the NL-YYYY-0001 numbering
//   • Today      — the day's lists grouped by company (print several in one PDF)
//   • Reports    — success rate / volume / problem workers
//   • Directory  — the original company directory (unchanged behaviour)
// The old directory view lives in ./name-list/name-list-directory.tsx.
import { useCallback, useState } from 'react'

import type { LetterheadConfig, NameListDetail } from '@/lib/types'
import { api } from '@/lib/api-client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '../shared/page-header'
import { NameListDirectoryView } from './name-list/name-list-directory'
import { WorkerListsView } from './name-list/worker-lists'
import { TodayBoard } from './name-list/today-board'
import { NLReports } from './name-list/nl-reports'
import { NameListSheetPrintDialog } from '../print/name-list-sheet-print'

export function NameListView() {
  const [tab, setTab] = useState('lists')
  const [openListId, setOpenListId] = useState<string | null>(null)
  const [printLists, setPrintLists] = useState<NameListDetail[]>([])
  const [printOpen, setPrintOpen] = useState(false)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)

  /** Fetch the company letterhead (cached after first read) and open the
   *  print preview — mirrors the Quotations module's pattern. */
  const openPrint = useCallback(
    async (lists: NameListDetail[]) => {
      if (lists.length > 0) {
        try {
          const res = await api.get<LetterheadConfig>('/api/letterhead')
          setLetterhead(res)
        } catch {
          setLetterhead(null)
        }
      }
      setPrintLists(lists)
      setPrintOpen(true)
    },
    []
  )

  function openListFromToday(id: string) {
    setOpenListId(id)
    setTab('lists')
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title="Name List"
          description="Worker deployment lists — interviews, trade tests, medicals, mobilization & demobilization."
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="print-hidden">
          <TabsTrigger value="lists">Lists</TabsTrigger>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="directory">Directory</TabsTrigger>
        </TabsList>
        <TabsContent value="lists" className="mt-3 sm:mt-4">
          <WorkerListsView openListId={openListId} onOpenListHandled={() => setOpenListId(null)} onPrintLists={openPrint} />
        </TabsContent>
        <TabsContent value="today" className="mt-3 sm:mt-4">
          <TodayBoard
            onOpenList={openListFromToday}
            onPrintLists={openPrint}
          />
        </TabsContent>
        <TabsContent value="reports" className="mt-3 sm:mt-4">
          <NLReports />
        </TabsContent>
        <TabsContent value="directory" className="mt-3 sm:mt-4">
          <NameListDirectoryView />
        </TabsContent>
      </Tabs>

      {/* A4 print preview — one list or a whole day's selection */}
      <NameListSheetPrintDialog
        lists={printLists}
        letterhead={letterhead}
        open={printOpen}
        onOpenChange={setPrintOpen}
      />
    </div>
  )
}
