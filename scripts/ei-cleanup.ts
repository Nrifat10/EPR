// DB cleanup for E-Invoice E2E — removes ALL test e-invoices, glossary terms,
// translation memory rows and resets the einvoice_* settings to defaults.
import { db } from '../src/lib/db'

async function main() {
  const delE = await db.eInvoice.deleteMany({})
  const delG = await db.glossaryTerm.deleteMany({})
  const delT = await db.translationMemory.deleteMany({})
  await db.setting.deleteMany({ where: { key: { in: [
    'einvoice_letterhead', 'einvoice_letterhead_top_mm', 'einvoice_letterhead_bottom_mm',
    'einvoice_signature', 'einvoice_stamp', 'einvoice_show_receiver_signature',
    'translate_provider', 'translate_api_key',
  ] } } })
  // prune activity logs created by the test module
  await db.activityLog.deleteMany({ where: { module: { in: ['einvoice', 'glossary'] } } })
  console.log(`deleted: ${delE.count} e-invoices, ${delG.count} glossary terms, ${delT.count} memory rows; settings reset`)
}

main().finally(() => db.$disconnect())
