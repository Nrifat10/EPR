// Name List module seeder — additive only, guarded by a Setting flag.
//   1. Creates the 5 system subjects (Interview, Trade Test, Medical,
//      Mobilization, Demobilization) with the boss's mandated badge colours.
//   2. Backfills the NEW Staff columns (nationality, passportNo, bloodGroup,
//      experienceYears) for existing workers so the print templates have data,
//      and sets deploymentStatus='deployed' for workers already on sites.
// Safe to re-run — the guard prevents duplicates.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const SYSTEM_SUBJECTS = [
  { name: 'Interview', color: '#2F6FB0', kind: 'interview', sortOrder: 1 },
  { name: 'Trade Test', color: '#C98A1B', kind: 'interview', sortOrder: 2 },
  { name: 'Medical', color: '#132A4A', kind: 'interview', sortOrder: 3 },
  { name: 'Mobilization', color: '#2E7D5B', kind: 'mobilization', sortOrder: 4 },
  { name: 'Demobilization', color: '#6B7488', kind: 'mobilization', sortOrder: 5 },
]

// Demo bio-data for the 14 existing workers (deterministic per name).
const BIO: Record<string, { nationality: string; passportNo: string; bloodGroup: string; experienceYears: number }> = {
  'Mohammad Rafiq': { nationality: 'Bangladesh', passportNo: 'BK0771234', bloodGroup: 'B+', experienceYears: 9 },
  'Abdul Karim': { nationality: 'Bangladesh', passportNo: 'BK0934567', bloodGroup: 'O+', experienceYears: 7 },
  'Suresh Kumar': { nationality: 'India', passportNo: 'Z4412398', bloodGroup: 'A+', experienceYears: 11 },
  'Mahmoud Hassan': { nationality: 'Egypt', passportNo: 'E1129873', bloodGroup: 'AB+', experienceYears: 6 },
  'Jahangir Alam': { nationality: 'Bangladesh', passportNo: 'BK0587412', bloodGroup: 'B-', experienceYears: 4 },
  'Ravi Prasad': { nationality: 'India', passportNo: 'Z9987312', bloodGroup: 'O-', experienceYears: 13 },
  'Kamal Hossain': { nationality: 'Bangladesh', passportNo: 'BK1102938', bloodGroup: 'A-', experienceYears: 3 },
  'Imran Sheikh': { nationality: 'Pakistan', passportNo: 'PK3341209', bloodGroup: 'B+', experienceYears: 8 },
  'Dilip Das': { nationality: 'India', passportNo: 'Z7734210', bloodGroup: 'O+', experienceYears: 5 },
  'Ahmed Sayed': { nationality: 'Egypt', passportNo: 'E4409821', bloodGroup: 'A+', experienceYears: 10 },
  'Babul Akter': { nationality: 'Bangladesh', passportNo: 'BK1345678', bloodGroup: 'AB-', experienceYears: 2 },
  'Nasir Ali': { nationality: 'Pakistan', passportNo: 'PK8812304', bloodGroup: 'B+', experienceYears: 12 },
  'Tarun Ghosh': { nationality: 'India', passportNo: 'Z5540921', bloodGroup: 'O+', experienceYears: 6 },
  'Faisal Rehman': { nationality: 'Pakistan', passportNo: 'PK6690214', bloodGroup: 'A+', experienceYears: 4 },
}

async function main() {
  const flag = await db.setting.findUnique({ where: { key: 'nameListSeeded' } })
  if (flag) {
    console.log('Name List seed already applied — skipping.')
    return
  }

  // 1 ── system subjects (upsert keeps names unique if partially present)
  for (const s of SYSTEM_SUBJECTS) {
    await db.nameListSubject.upsert({
      where: { name: s.name },
      update: { color: s.color, kind: s.kind, sortOrder: s.sortOrder, isSystem: true },
      create: { ...s, isSystem: true },
    })
  }
  console.log(`Subjects: ${SYSTEM_SUBJECTS.length} system subjects ensured.`)

  // 2 ── staff backfill: only fill NULL columns, never overwrite real data
  const staff = await db.staff.findMany({ include: { projects: true } })
  let filled = 0
  let deployed = 0
  for (const s of staff) {
    const bio = BIO[s.fullName]
    const patch: Record<string, unknown> = {}
    if (bio) {
      if (!s.nationality) patch.nationality = bio.nationality
      if (!s.passportNo) patch.passportNo = bio.passportNo
      if (!s.bloodGroup) patch.bloodGroup = bio.bloodGroup
      if (s.experienceYears == null) patch.experienceYears = bio.experienceYears
    }
    // workers with an active site assignment are deployed
    if (s.projects.length > 0 && s.deploymentStatus === 'available') patch.deploymentStatus = 'deployed'
    if (Object.keys(patch).length > 0) {
      await db.staff.update({ where: { id: s.id }, data: patch })
      filled++
      if (patch.deploymentStatus) deployed++
    }
  }
  console.log(`Staff: ${filled} updated (${deployed} marked deployed).`)

  await db.setting.create({ data: { key: 'nameListSeeded', value: 'true' } })
  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
