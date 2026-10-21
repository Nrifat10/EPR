// Shared seed logic — imported by BOTH the prisma/seed.ts CLI and the
// /api/bootstrap route (self-healing empty-database recovery).
// No 'server-only' guard: the CLI script runs outside Next.js.
import { PrismaClient, Project, Staff, StaffCategory, TransactionCategory, Client } from '@prisma/client'
import { randomBytes, scrypt as _scrypt } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(_scrypt) as (p: string, s: string, k: number) => Promise<Buffer>

export type SeedSummary = {
  users: number
  roles: number
  clients: number
  projects: number
  staffCategories: number
  staff: number
  payrolls: number
  paidPayrolls: number
  attendance: number
  transactions: number
  settings: number
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

/**
 * Wipe + recreate the full demo dataset (roles, users, settings, projects,
 * staff, attendance, payrolls, transactions, activity). Deterministic RNG so
 * every environment gets identical demo data.
 */
export async function runSeed(db: PrismaClient): Promise<SeedSummary> {
  // Deterministic RNG for reproducible demo data (local state — safe to re-run)
  let randSeed = 20241031
  function rand(): number {
    randSeed |= 0
    randSeed = (randSeed + 0x6d2b79f5) | 0
    let t = Math.imul(randSeed ^ (randSeed >>> 15), 1 | randSeed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
  const randPick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  // Wipe (order matters for FKs)
  await db.activityLog.deleteMany()
  await db.transaction.deleteMany()
  await db.transactionCategory.deleteMany()
  await db.payroll.deleteMany()
  await db.attendance.deleteMany()
  await db.projectStaff.deleteMany()
  await db.staff.deleteMany()
  await db.staffCategory.deleteMany()
  await db.project.deleteMany()
  await db.client.deleteMany()
  await db.session.deleteMany()
  await db.user.deleteMany()
  await db.role.deleteMany()
  await db.setting.deleteMany()

  // ---------- Roles ----------
  const payrollPerms = ['payroll.view', 'payroll.create', 'payroll.edit', 'payroll.delete', 'payroll.print']
  const superAdmin = await db.role.create({
    data: { name: 'Super Admin', description: 'Full access to all modules', permissions: JSON.stringify(['*']) },
  })
  const accountant = await db.role.create({
    data: {
      name: 'Accountant',
      description: 'Manage accounts, payroll and reports',
      permissions: JSON.stringify([
        'dashboard.view', 'projects.view', 'staff.view', 'attendance.view',
        'clients.view',
        ...payrollPerms,
        'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.delete',
      ]),
    },
  })
  const hrManager = await db.role.create({
    data: {
      name: 'HR Manager',
      description: 'Manage staff, attendance and payroll',
      permissions: JSON.stringify([
        'dashboard.view', 'projects.view', 'projects.create', 'projects.edit',
        'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
        'staff.view', 'staff.create', 'staff.edit', 'staff.delete',
        'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.delete',
        ...payrollPerms,
        'accounts.view',
      ]),
    },
  })
  const viewer = await db.role.create({
    data: {
      name: 'Viewer',
      description: 'Read-only access to dashboards and reports',
      permissions: JSON.stringify([
        'dashboard.view', 'projects.view', 'staff.view', 'attendance.view',
        'payroll.view', 'accounts.view', 'activity.view', 'clients.view',
      ]),
    },
  })

  // ---------- Users ----------
  const pwd = await hashPassword('password')
  const admin = await db.user.create({
    data: { name: 'Ahmed Al-Farsi', email: 'admin@example.com', password: pwd, roleId: superAdmin.id },
  })
  const user2 = await db.user.create({
    data: { name: 'Fatima Noor', email: 'accountant@example.com', password: pwd, roleId: accountant.id },
  })
  const user3 = await db.user.create({
    data: { name: 'Bilal Hussain', email: 'hr@example.com', password: pwd, roleId: hrManager.id },
  })
  await db.user.create({
    data: { name: 'Sara Ahmed', email: 'viewer@example.com', password: pwd, roleId: viewer.id },
  })

  // ---------- Settings ----------
  const settings: Record<string, string> = {
    companyName: 'Landmark Inter Gulf',
    address:
      'Al Suwedhi Business Centre, Office # 103, 1st Floor, P.O.Box 35712, Building 5526, 4th Street, Distt. Al Wahah, Jubail, Kingdom of Saudi Arabia',
    phone: '+966 13 847 2200',
    email: 'info@landmarkintergulf.com',
    currency: 'SAR',
    defaultPayType: 'bank_transfer',
    authorizedSignatory: 'Faisal Al-Otaibi',
    signatoryTitle: 'Finance Manager',
    vatRate: '15',
  }
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.create({ data: { key, value } })
  }

  // ---------- Clients (companies we supply workforce to) ----------
  const clientData: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      name: 'Gulf Crescent Contracting Co.',
      contactPerson: 'Bandar Al-Suwailem',
      phone: '+966 11 461 7300',
      email: 'projects@gulfcrescent.sa',
      address: 'King Fahd Road, Al Olaya District',
      city: 'Riyadh',
      crNumber: '1010234781',
      vatNumber: '310102347810003',
      nameAr: 'شركة الهلال الخليج للمقاولات',
      addressAr: 'طريق الملك فهد، حي العليا',
      bankName: 'Saudi National Bank',
      iban: 'SA0310000012345678901234',
      accountNumber: '12345678901234',
      swiftCode: 'NCBKSAJE',
      status: 'active',
      notes: 'Preferred client — quarterly manpower contracts since 2022.',
    },
    {
      name: 'Eastern Province Industrial Services',
      contactPerson: 'Nasser Al-Dosari',
      phone: '+966 13 812 4460',
      email: 'nasser.dosari@epis.com.sa',
      address: '1st Industrial Street, 2nd Industrial City',
      city: 'Dammam',
      crNumber: '2050188364',
      vatNumber: '320501883640003',
      nameAr: 'خدمات المنطقة الشرقية الصناعية',
      addressAr: 'الشارع الصناعي الأول، المدينة الصناعية الثانية',
      bankName: 'Riyad Bank',
      iban: 'SA4420000001234567891234',
      accountNumber: '12345678912345',
      swiftCode: 'RIBLSARI',
      status: 'active',
      notes: null,
    },
    {
      name: 'Al Waha Engineering Group',
      contactPerson: 'Rami Haddad',
      phone: '+966 13 959 2011',
      email: 'rami@alwahaeng.com',
      address: 'Jubail Industrial City, Madinat Al Jubail',
      city: 'Jubail',
      crNumber: '2050229177',
      vatNumber: '320502291770003',
      nameAr: 'مجموعة الوها الهندسية',
      addressAr: 'مدينة الجبيل الصناعية',
      bankName: 'Saudi British Bank',
      iban: 'SA5520000002345678901234',
      accountNumber: '23456789012345',
      swiftCode: 'ABPASARI',
      status: 'active',
      notes: 'Requires monthly QHSE compliance reports with invoices.',
    },
    {
      name: 'Red Sea Marine & Contracting',
      contactPerson: 'Yousef Al-Ghamdi',
      phone: '+966 17 722 8654',
      email: 'y.ghamdi@redseamarine.sa',
      address: 'Corniche Road, Al Baghdadiyah Al Gharbiyah',
      city: 'Jeddah',
      crNumber: '4030115620',
      vatNumber: '340301156200003',
      nameAr: 'البحر الأحمر للإنشاءات البحرية',
      addressAr: 'طريق الكورنيش، البغدادية الغربية',
      bankName: 'Al Rajhi Bank',
      iban: 'SA6680000003456789012345',
      accountNumber: '34567890123456',
      swiftCode: 'RJHISARI',
      status: 'active',
      notes: null,
    },
    {
      name: 'Tabuk Northern Partners',
      contactPerson: 'Majed Al-Balawi',
      phone: '+966 14 423 9087',
      email: 'majed@tnp.sa',
      address: 'Prince Sultan Road, Tabuk 71411',
      city: 'Tabuk',
      crNumber: '4040997325',
      vatNumber: '340409973250003',
      nameAr: 'شركاء تبوك الشمالية',
      addressAr: 'طريق الأمير سلطان، تبوك',
      bankName: 'Arab National Bank',
      iban: 'SA7750000004567890123456',
      accountNumber: '45678901234567',
      swiftCode: 'ARNBSARI',
      status: 'inactive',
      notes: 'NEOM-related framework agreement on hold pending scope revision.',
    },
    {
      name: 'Jeddah Coastal Facilities Management',
      contactPerson: 'Omar Shalabi',
      phone: '+966 12 651 3390',
      email: 'omar.shalabi@jcfm.sa',
      address: 'Al Andalus District, Ibrahim Al Angari Street',
      city: 'Jeddah',
      crNumber: '4030448173',
      vatNumber: '340304481730003',
      nameAr: 'جدة لإدارة المرافق الساحلية',
      addressAr: 'حي الأندلس، شارع إبراهيم الأنصاري',
      bankName: 'Bank Albilad',
      iban: 'SA8890000005678901234567',
      accountNumber: '56789012345678',
      swiftCode: 'ALBISARI',
      status: 'active',
      notes: 'Prospective client for facilities maintenance crews.',
    },
  ]
  const clients: Record<string, Client> = {}
  for (const c of clientData) {
    const created = await db.client.create({ data: c })
    clients[c.name] = created
  }

  // ---------- Projects (each linked to a client company) ----------
  const projectData: { name: string; managerName: string; location: string; status: string; client: string }[] = [
    { name: 'Aramco Rig Upgrade — Phase 3', managerName: 'Khalid Al-Otaibi', location: 'Dammam', status: 'active', client: 'Eastern Province Industrial Services' },
    { name: 'SABIC Gas Plant Piping Works', managerName: 'Khalid Al-Otaibi', location: 'Jubail Industrial City', status: 'active', client: 'Al Waha Engineering Group' },
    { name: 'Riyadh Metro Line 4 — Civil Package', managerName: 'Faisal Al-Harbi', location: 'Riyadh', status: 'active', client: 'Gulf Crescent Contracting Co.' },
    { name: 'Jazan Refinery Coating Project', managerName: 'Marco Delgado', location: 'Jazan', status: 'active', client: 'Red Sea Marine & Contracting' },
    { name: 'NEOM Substation Construction', managerName: 'Faris Al-Qahtani', location: 'Tabuk (NEOM)', status: 'inactive', client: 'Tabuk Northern Partners' },
    { name: 'Yanbu Petrochemical Turnaround', managerName: 'Marco Delgado', location: 'Yanbu', status: 'completed', client: 'Red Sea Marine & Contracting' },
  ]
  const projects: Project[] = []
  for (const p of projectData) {
    projects.push(
      await db.project.create({
        data: {
          name: p.name,
          managerName: p.managerName,
          location: p.location,
          status: p.status,
          clientId: clients[p.client]?.id ?? null,
        },
      })
    )
  }

  // ---------- Staff Categories ----------
  const catData: [string, string][] = [
    ['PIPING QCI', 'Quality Control Inspector — Piping'],
    ['PIPING QCS', 'Quality Control Supervisor — Piping'],
    ['PIPE FITTER', 'Pipe fitting and fabrication'],
    ['PIPING WELDER', 'Certified pipe welders (6G)'],
    ['WELDING QCS', 'Quality Control Supervisor — Welding'],
    ['RIGGER', 'Lifting and rigging operations'],
    ['HELPER', 'General site helpers'],
    ['LINE CHECKER', 'Pipeline line checking'],
    ['COATING QCI', 'Quality Control Inspector — Coating'],
    ['COORDINATOR', 'Site coordination and planning'],
    ['OFFICE MANAGER', 'Administrative and office management'],
    ['PICKUP DRIVER', 'Site transportation drivers'],
    ['PLATE WELDER', 'Structural plate welding'],
  ]
  const cats: Record<string, StaffCategory> = {}
  for (const [name, description] of catData) {
    cats[name] = await db.staffCategory.create({ data: { name, description } })
  }

  // ---------- Staff (40) ----------
  const rateMap: Record<string, [number, number]> = {
    'PIPING QCI': [70, 85],
    'PIPING QCS': [85, 100],
    'PIPE FITTER': [38, 52],
    'PIPING WELDER': [48, 65],
    'WELDING QCS': [85, 100],
    'RIGGER': [30, 42],
    'HELPER': [18, 26],
    'LINE CHECKER': [32, 45],
    'COATING QCI': [65, 80],
    'COORDINATOR': [55, 70],
    'OFFICE MANAGER': [45, 60],
    'PICKUP DRIVER': [22, 32],
    'PLATE WELDER': [45, 60],
  }
  const staffSeed: [string, string, string, number[]][] = [
    // name, position, category, project indexes (0-5)
    ['Muhammad Rafiq', 'Sr. QC Inspector', 'PIPING QCI', [0, 1]],
    ['Abdul Kareem', 'QC Inspector', 'PIPING QCI', [1]],
    ['Suresh Kumar', 'QC Inspector', 'PIPING QCI', [2]],
    ['Rajesh Nair', 'QC Supervisor', 'PIPING QCS', [0, 2]],
    ['Anil Menon', 'QC Supervisor', 'PIPING QCS', [1]],
    ['Mohammed Ashraf', 'Pipe Fitter', 'PIPE FITTER', [0]],
    ['Imran Sheikh', 'Pipe Fitter', 'PIPE FITTER', [1]],
    ['Joseph Santos', 'Pipe Fitter', 'PIPE FITTER', [2]],
    ['Ravi Prasad', 'Pipe Fitter', 'PIPE FITTER', [0, 3]],
    ['Dilip Kumar', 'Pipe Fitter', 'PIPE FITTER', [1]],
    ['Nasir Mehmood', 'Welder 6G', 'PIPING WELDER', [0]],
    ['Ajay Verma', 'Welder 6G', 'PIPING WELDER', [1]],
    ['Shahid Mahmood', 'Welder 6G', 'PIPING WELDER', [2, 3]],
    ['Ramesh Chandra', 'Welder 6G', 'PIPING WELDER', [0]],
    ['Rustam Ali', 'QC Supervisor', 'WELDING QCS', [0, 1]],
    ['Ganesh Iyer', 'QC Supervisor', 'WELDING QCS', [3]],
    ['Babar Hussain', 'Rigger', 'RIGGER', [0]],
    ['Zahid Akram', 'Rigger', 'RIGGER', [1]],
    ['Sanjay Patel', 'Rigger', 'RIGGER', [2]],
    ['Mohsin Raza', 'Helper', 'HELPER', [0]],
    ['Alamin Hossain', 'Helper', 'HELPER', [1]],
    ['Rahul Das', 'Helper', 'HELPER', [2]],
    ['Kamrul Islam', 'Helper', 'HELPER', [3]],
    ['Tapas Roy', 'Helper', 'HELPER', [0, 1]],
    ['Niraj Thapa', 'Line Checker', 'LINE CHECKER', [0]],
    ['Deepak Gurung', 'Line Checker', 'LINE CHECKER', [1, 3]],
    ['Manoj Bhandari', 'Line Checker', 'LINE CHECKER', [2]],
    ['Saleem Anwar', 'QC Inspector', 'COATING QCI', [3]],
    ['Tariq Jamil', 'QC Inspector', 'COATING QCI', [3, 5]],
    ['Hassan Rizvi', 'Site Coordinator', 'COORDINATOR', [0, 1]],
    ['Waqar Younis', 'Site Coordinator', 'COORDINATOR', [2]],
    ['Nadeem Abbasi', 'Office Manager', 'OFFICE MANAGER', []],
    ['Salem Al-Dosari', 'Pickup Driver', 'PICKUP DRIVER', [0, 1, 2]],
    ['Iqbal Masih', 'Pickup Driver', 'PICKUP DRIVER', [3]],
    ['Faisal Mahmud', 'Plate Welder', 'PLATE WELDER', [2]],
    ['Aslam Pervez', 'Plate Welder', 'PLATE WELDER', [0]],
    ['Yasir Abbas', 'Plate Welder', 'PLATE WELDER', [1]],
    ['Mehrab Jan', 'Pipe Fitter', 'PIPE FITTER', [3]],
    ['Sunil Shrestha', 'Rigger', 'RIGGER', [3]],
    ['Bashir Ahmed', 'Helper', 'HELPER', [5]],
  ]

  let iqamaCounter = 2471889914
  const staff: Staff[] = []
  const now = new Date()
  for (let i = 0; i < staffSeed.length; i++) {
    const [fullName, position, catName, projIdx] = staffSeed[i]
    const [rMin, rMax] = rateMap[catName]
    const rate = i === 0 ? 75 : round2(randInt(rMin, rMax)) // first staff fixed at 75 for the spec verification example
    const otRate = round2(rate * 1.5)
    const joinYearsAgo = randInt(1, 6)
    const joiningDate = new Date(now.getFullYear() - joinYearsAgo, randInt(0, 11), randInt(1, 28))
    const status = i === 39 ? 'inactive' : 'active'
    // IQAMA expiry demo distribution (mirrors scripts/backfill-expiry.ts):
    // i%10===0 → expired, i%10===1 or i===2 → expiring ≤90d, rest valid
    const m = i % 10
    const iqamaDays = m === 0 ? -(12 + i * 6) : m === 1 || i === 2 ? 14 + i : 180 + m * 40 + i
    const iqamaExpiry = new Date(now.getTime() + iqamaDays * 86_400_000)
    const passportDays = iqamaDays < 0 ? 300 + i * 7 : iqamaDays + 400 + (i % 5) * 90
    const passportExpiry = new Date(now.getTime() + Math.min(passportDays, 1500) * 86_400_000)
    const s = await db.staff.create({
      data: {
        fullName,
        phone: `+9665${randInt(10000000, 59999999)}`,
        position,
        staffCategoryId: cats[catName].id,
        iqamaId: String(iqamaCounter++),
        joiningDate,
        iqamaExpiry,
        passportExpiry,
        ratePerHour: rate,
        overtimeRate: otRate,
        monthlySalary: round2(rate * 208),
        residentialAddress: `${randPick(['Al Khobar', 'Dammam', 'Riyadh', 'Jubail'])}, KSA`,
        status,
      },
    })
    staff.push(s)
    for (const pi of projIdx) {
      await db.projectStaff.create({ data: { projectId: projects[pi].id, staffId: s.id } })
    }
  }

  // ---------- Attendance (last 2 months) ----------
  let attendanceCount = 0
  const activeStaff = staff.filter((s) => s.status === 'active')
  for (const s of activeStaff) {
    const assignments = await db.projectStaff.findMany({ where: { staffId: s.id } })
    for (let mBack = 2; mBack >= 1; mBack--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - mBack, 1)
      const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
      const recordCount = randInt(14, 20)
      const usedDays = new Set<number>()
      for (let r = 0; r < recordCount; r++) {
        let day = randInt(1, daysInMonth)
        while (usedDays.has(day)) day = randInt(1, daysInMonth)
        usedDays.add(day)
        const checkIn = new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 7, randInt(0, 45))
        const durationMin = randInt(9, 12) * 60 + randPick([0, 15, 30, 45])
        const checkOut = new Date(checkIn.getTime() + durationMin * 60000)
        await db.attendance.create({
          data: {
            staffId: s.id,
            projectId: assignments.length ? randPick(assignments).projectId : null,
            checkIn,
            checkOut,
            durationMinutes: durationMin,
          },
        })
        attendanceCount++
      }
    }
  }

  // ---------- Transaction categories ----------
  const incomeCats: Record<string, TransactionCategory> = {}
  const expenseCats: Record<string, TransactionCategory> = {}
  for (const [name] of [['Project Payment'], ['Service Charge'], ['Consultancy']]) {
    incomeCats[name] = await db.transactionCategory.create({ data: { name, type: 'income' } })
  }
  for (const [name] of [['Salary'], ['Office'], ['Transport'], ['Accommodation'], ['Visa/Iqama'], ['Other']]) {
    expenseCats[name] = await db.transactionCategory.create({ data: { name, type: 'expense' } })
  }

  // ---------- Payrolls (previous month) ----------
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = prevMonthDate.getMonth() + 1
  const prevYear = prevMonthDate.getFullYear()
  const payDate = new Date(prevYear, prevMonth - 1, 28)
  const payrollStaff = activeStaff.slice(0, 32)
  let createdPaid = 0
  for (const s of payrollStaff) {
    const assignments = await db.projectStaff.findMany({ where: { staffId: s.id } })
    const projectId = assignments.length ? assignments[0].projectId : null
    // First staff gets the EXACT spec verification example: 200h×75, +100 other, union 200, 10% → net 13,390.00
    const isFirst = s.id === staff[0].id
    const totalHours = isFirst ? 200 : randInt(176, 224)
    const overtimeHours = isFirst ? 0 : randInt(0, 32)
    const otherEarnings = isFirst ? 100 : randPick([0, 0, 0, 50, 100, 150])
    const advance = isFirst ? 0 : randPick([0, 0, 0, 200, 500])
    const absentPenalty = isFirst ? 0 : randPick([0, 0, 0, 0, 100])
    const ptAmount = isFirst ? 0 : randPick([0, 0, 50, 100])
    const unionFees = isFirst ? 200 : randPick([0, 100, 200])
    const otherDeductionValue = isFirst ? 10 : randPick([0, 0, 5, 10, 200])
    const otherDeductionType = isFirst ? 'percent' : (otherDeductionValue <= 10 ? 'percent' : 'fixed')

    const regularPay = round2(totalHours * s.ratePerHour)
    const overtimePay = round2(overtimeHours * s.overtimeRate)
    const grossPay = round2(regularPay + overtimePay + otherEarnings)
    const otherDed = round2(otherDeductionType === 'percent' ? (grossPay * otherDeductionValue) / 100 : otherDeductionValue)
    const totalDeductions = round2(advance + absentPenalty + ptAmount + unionFees + otherDed)
    const netPay = Math.max(0, round2(grossPay - totalDeductions))

    const paid = isFirst || rand() < 0.6
    const p = await db.payroll.create({
      data: {
        staffId: s.id,
        projectId,
        month: prevMonth,
        year: prevYear,
        totalHours,
        hourlyRateSnapshot: s.ratePerHour,
        overtimeHours,
        overtimeRateSnapshot: s.overtimeRate,
        otherEarnings,
        advance,
        absentPenalty,
        ptAmount,
        unionFees,
        otherDeductionValue,
        otherDeductionType,
        grossPay,
        totalDeductions,
        netPay,
        status: paid ? 'paid' : 'pending',
        payDate: paid ? payDate : null,
        payType: 'bank_transfer',
        taxCode: 'N/A',
        createdBy: admin.id,
      },
    })
    if (paid) {
      createdPaid++
      await db.transaction.create({
        data: {
          type: 'expense',
          title: `Salary Payment: ${s.fullName}`,
          amount: netPay,
          transactionCategoryId: expenseCats['Salary'].id,
          projectId,
          operatorUserId: user2.id,
          transactionDate: payDate,
          description: `Monthly salary disbursement — ${prevMonth}/${prevYear}`,
          payrollId: p.id,
        },
      })
      await db.activityLog.create({
        data: {
          userId: user2.id,
          userName: user2.name,
          action: 'paid',
          module: 'payroll',
          description: `Salary Payment: ${s.fullName} — ${prevMonth}/${prevYear}`,
          amount: netPay,
        },
      })
    }
  }

  // ---------- Income / Expense rows (last 6 months) ----------
  let transactionCount = 0
  for (let mBack = 5; mBack >= 0; mBack--) {
    const mDate = new Date(now.getFullYear(), now.getMonth() - mBack, 1)
    const daysInMonth = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate()
    // 2-4 project payments
    const payments = randInt(2, 4)
    for (let i = 0; i < payments; i++) {
      const proj = randPick(projects.filter((p) => p.status !== 'completed'))
      await db.transaction.create({
        data: {
          type: 'income',
          title: `Project Payment — ${proj.name}`,
          amount: round2(randInt(120, 480) * 1000),
          transactionCategoryId: incomeCats['Project Payment'].id,
          projectId: proj.id,
          operatorUserId: admin.id,
          transactionDate: new Date(mDate.getFullYear(), mDate.getMonth(), randInt(1, daysInMonth)),
          description: 'Monthly manpower supply invoice settled',
        },
      })
      transactionCount++
    }
    if (rand() < 0.4) {
      await db.transaction.create({
        data: {
          type: 'income',
          title: 'Consultancy Service Fee',
          amount: round2(randInt(8, 25) * 1000),
          transactionCategoryId: incomeCats['Consultancy'].id,
          operatorUserId: user2.id,
          transactionDate: new Date(mDate.getFullYear(), mDate.getMonth(), randInt(1, daysInMonth)),
          description: 'QHSE consultancy retainer',
        },
      })
      transactionCount++
    }
    // Regular expenses
    const expenses: [string, number, number, string][] = [
      ['Office Rent & Utilities', 18000, 32000, 'Office'],
      ['Staff Transportation', 9000, 16000, 'Transport'],
      ['Accommodation — Camp B', 45000, 68000, 'Accommodation'],
      ['Iqama Renewals & Visas', 6000, 18000, 'Visa/Iqama'],
    ]
    for (const [title, min, max, cat] of expenses) {
      await db.transaction.create({
        data: {
          type: 'expense',
          title,
          amount: round2(randInt(min, max)),
          transactionCategoryId: expenseCats[cat].id,
          operatorUserId: user2.id,
          transactionDate: new Date(mDate.getFullYear(), mDate.getMonth(), randInt(1, daysInMonth)),
          description: 'Monthly operational expense',
        },
      })
      transactionCount++
    }
  }

  // A couple of activity logs for the feed
  await db.activityLog.create({
    data: {
      userId: admin.id, userName: admin.name, action: 'created', module: 'project',
      description: 'Created project: Aramco Rig Upgrade — Phase 3',
    },
  })
  await db.activityLog.create({
    data: {
      userId: user3.id, userName: user3.name, action: 'created', module: 'staff',
      description: 'Added new staff: Muhammad Rafiq (PIPING QCI)',
    },
  })
  // Demo login events (spread over the last few days) so the Activity Log
  // shows the 'login' action out of the box (same shape as runtime logins)
  const loginUsers = [admin, user2, user3]
  for (let d = 5; d >= 1; d--) {
    const u = loginUsers[d % loginUsers.length]
    await db.activityLog.create({
      data: {
        userId: u.id,
        userName: u.name,
        action: 'login',
        module: 'user',
        description: `${u.name} signed in`,
        createdAt: new Date(now.getTime() - d * 86_400_000 - randInt(1, 8) * 3_600_000),
      },
    })
  }

  return {
    users: 4,
    roles: 4,
    clients: clientData.length,
    projects: projects.length,
    staffCategories: catData.length,
    staff: staff.length,
    payrolls: payrollStaff.length,
    paidPayrolls: createdPaid,
    attendance: attendanceCount,
    transactions: transactionCount,
    settings: Object.keys(settings).length,
  }
}
