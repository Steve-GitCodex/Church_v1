import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ROLES = [
  { name: 'ChairPerson',      max: 1 },
  { name: 'Vice Chairperson', max: 1 },
  { name: 'Treasurer',        max: 1 },
  { name: 'Secretary',        max: 1 },
  { name: 'Vice Secretary',   max: 1 },
  { name: 'Coordinator',      max: 1 },
]

async function main() {
  const hash = await bcrypt.hash('Test1234!', 12)

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('Creating users…')

  const users = [
    {
      email: 'admin@aicruiru.org',  phone: '+254700000001',
      role: 'SUPER_ADMIN', permissions: null,
      first: 'James',   last: 'Kariuki',  dob: '1975-03-10', joined: '2005-01-15',
    },
    {
      email: 'pastor@aicruiru.org', phone: '+254700000002',
      role: 'ADMIN', permissions: null,
      first: 'David',   last: 'Mwangi',   dob: '1970-08-22', joined: '2008-06-01',
    },
    {
      email: 'secretary@aicruiru.org', phone: '+254700000003',
      role: 'STAFF',
      permissions: { manageMembers: true, manageContent: true, manageGivings: false, manageEvents: true },
      first: 'Grace',   last: 'Njoroge',  dob: '1985-11-14', joined: '2015-02-10',
    },
    {
      email: 'john.kamau@example.com',    phone: '+254711000001',
      role: 'MEMBER', permissions: null,
      first: 'John',    last: 'Kamau',    dob: '1985-04-12', joined: '2018-01-10',
    },
    {
      email: 'mary.odhiambo@example.com', phone: '+254711000002',
      role: 'MEMBER', permissions: null,
      first: 'Mary',    last: 'Odhiambo', dob: '1990-07-23', joined: '2019-03-15',
    },
    {
      email: 'peter.musyoka@example.com', phone: '+254711000003',
      role: 'MEMBER', permissions: null,
      first: 'Peter',   last: 'Musyoka',  dob: '1978-11-05', joined: '2016-08-20',
    },
    {
      email: 'susan.wanjiku@example.com', phone: '+254711000004',
      role: 'MEMBER', permissions: null,
      first: 'Susan',   last: 'Wanjiku',  dob: '1992-02-28', joined: '2020-02-14',
    },
    {
      email: 'samuel.kipchoge@example.com', phone: '+254711000005',
      role: 'MEMBER', permissions: null,
      first: 'Samuel',  last: 'Kipchoge', dob: '1988-09-17', joined: '2017-11-01',
    },
    {
      email: 'faith.achieng@example.com', phone: '+254711000006',
      role: 'MEMBER', permissions: null,
      first: 'Faith',   last: 'Achieng',  dob: '1995-05-30', joined: '2021-01-07',
    },
    {
      email: 'daniel.njenga@example.com', phone: '+254711000007',
      role: 'MEMBER', permissions: null,
      first: 'Daniel',  last: 'Njenga',   dob: '1982-12-14', joined: '2014-05-18',
    },
    {
      email: 'esther.waithera@example.com', phone: '+254711000008',
      role: 'MEMBER', permissions: null,
      first: 'Esther',  last: 'Waithera', dob: '1993-08-09', joined: '2022-06-25',
    },
    // Extra members for pagination testing
    { email: 'alice.wambui@example.com',    phone: '+254722000001', role: 'MEMBER', permissions: null, first: 'Alice',    last: 'Wambui',    dob: '1991-03-14', joined: '2020-04-01' },
    { email: 'brian.mutua@example.com',     phone: '+254722000002', role: 'MEMBER', permissions: null, first: 'Brian',    last: 'Mutua',     dob: '1987-06-22', joined: '2019-07-10' },
    { email: 'caroline.kerubo@example.com', phone: '+254722000003', role: 'MEMBER', permissions: null, first: 'Caroline', last: 'Kerubo',    dob: '1996-09-05', joined: '2021-03-15' },
    { email: 'dennis.kimani@example.com',   phone: '+254722000004', role: 'MEMBER', permissions: null, first: 'Dennis',   last: 'Kimani',    dob: '1983-11-30', joined: '2015-09-20' },
    { email: 'eunice.nyambura@example.com', phone: '+254722000005', role: 'MEMBER', permissions: null, first: 'Eunice',   last: 'Nyambura',  dob: '1994-01-18', joined: '2022-01-08' },
    { email: 'felix.omondi@example.com',    phone: '+254722000006', role: 'MEMBER', permissions: null, first: 'Felix',    last: 'Omondi',    dob: '1980-04-07', joined: '2013-06-30' },
    { email: 'gloria.chebet@example.com',   phone: '+254722000007', role: 'MEMBER', permissions: null, first: 'Gloria',   last: 'Chebet',    dob: '1997-07-25', joined: '2023-02-12' },
    { email: 'henry.gacheru@example.com',   phone: '+254722000008', role: 'MEMBER', permissions: null, first: 'Henry',    last: 'Gacheru',   dob: '1979-12-03', joined: '2012-11-05' },
    { email: 'irene.njeri@example.com',     phone: '+254722000009', role: 'MEMBER', permissions: null, first: 'Irene',    last: 'Njeri',     dob: '1993-08-16', joined: '2020-08-22' },
    { email: 'jacob.wekesa@example.com',    phone: '+254722000010', role: 'MEMBER', permissions: null, first: 'Jacob',    last: 'Wekesa',    dob: '1986-05-11', joined: '2016-03-14' },
    { email: 'kathleen.auma@example.com',   phone: '+254722000011', role: 'MEMBER', permissions: null, first: 'Kathleen', last: 'Auma',      dob: '1998-02-27', joined: '2023-07-19' },
    { email: 'laban.korir@example.com',     phone: '+254722000012', role: 'MEMBER', permissions: null, first: 'Laban',    last: 'Korir',     dob: '1975-10-09', joined: '2010-05-03' },
    { email: 'miriam.nduta@example.com',    phone: '+254722000013', role: 'MEMBER', permissions: null, first: 'Miriam',   last: 'Nduta',     dob: '1992-06-20', joined: '2019-11-28' },
    { email: 'noah.onyango@example.com',    phone: '+254722000014', role: 'MEMBER', permissions: null, first: 'Noah',     last: 'Onyango',   dob: '1984-03-02', joined: '2017-08-06' },
    { email: 'olivia.muthoni@example.com',  phone: '+254722000015', role: 'MEMBER', permissions: null, first: 'Olivia',   last: 'Muthoni',   dob: '1999-11-13', joined: '2024-01-15' },
    { email: 'paul.simiyu@example.com',     phone: '+254722000016', role: 'MEMBER', permissions: null, first: 'Paul',     last: 'Simiyu',    dob: '1981-08-28', joined: '2014-02-17' },
    { email: 'rachel.wangari@example.com',  phone: '+254722000017', role: 'MEMBER', permissions: null, first: 'Rachel',   last: 'Wangari',   dob: '1995-04-04', joined: '2021-09-30' },
    { email: 'stephen.nganga@example.com',  phone: '+254722000018', role: 'MEMBER', permissions: null, first: 'Stephen',  last: 'Nganga',    dob: '1977-01-21', joined: '2009-04-12' },
    { email: 'tabitha.nekesa@example.com',  phone: '+254722000019', role: 'MEMBER', permissions: null, first: 'Tabitha',  last: 'Nekesa',    dob: '1990-09-08', joined: '2018-06-03' },
    { email: 'victor.maina@example.com',    phone: '+254722000020', role: 'MEMBER', permissions: null, first: 'Victor',   last: 'Maina',     dob: '1988-12-17', joined: '2017-01-25' },
    // Pending — tests the approvals queue
    {
      email: 'kevin.otieno@example.com', phone: '+254711000099',
      role: 'PENDING', permissions: null,
      first: 'Kevin',   last: 'Otieno',   dob: '2000-01-01', joined: null,
    },
  ]

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email:        u.email,
        phone:        u.phone,
        passwordHash: hash,
        role:         u.role,
        isActive:     true,
        otpVerifiedAt: new Date(),
        permissions:  u.permissions,
        profile: {
          create: {
            firstName:        u.first,
            lastName:         u.last,
            dateOfBirth:      u.dob    ? new Date(u.dob)    : null,
            dateJoined:       u.joined ? new Date(u.joined) : null,
            membershipStatus: 'ACTIVE',
          },
        },
      },
    })
  }

  // ── Households ─────────────────────────────────────────────────────────────
  console.log('Creating households…')

  // Fixed seed IDs so re-running is idempotent
  const households = [
    { id: 'seed-hh-1', name: "Kamau's Family",    members: ['john.kamau@example.com', 'susan.wanjiku@example.com'] },
    { id: 'seed-hh-2', name: 'Odhiambo Family',   members: ['mary.odhiambo@example.com'] },
    { id: 'seed-hh-3', name: "Musyoka's Family",   members: ['peter.musyoka@example.com', 'esther.waithera@example.com'] },
    { id: 'seed-hh-4', name: 'Kipchoge Family',    members: ['samuel.kipchoge@example.com'] },
  ]

  for (const hh of households) {
    await prisma.household.upsert({
      where:  { id: hh.id },
      update: {},
      create: { id: hh.id, name: hh.name },
    })
    for (const email of hh.members) {
      const u = await prisma.user.findUnique({ where: { email }, include: { profile: true } })
      if (u?.profile) {
        await prisma.memberProfile.update({
          where: { id: u.profile.id },
          data:  { householdId: hh.id },
        })
      }
    }
  }

  // ── Ministries + memberships ───────────────────────────────────────────────
  console.log('Creating ministries…')

  const ministryDefs = [
    { name: 'Choir',              description: 'Praise and worship team' },
    { name: 'Youth Ministry',     description: 'Ministry for young people aged 18–35' },
    { name: "Women's Fellowship", description: 'Fellowship and discipleship for women' },
    { name: "Men's Fellowship",   description: 'Brotherhood and accountability for men' },
    { name: 'Children Ministry',  description: 'Sunday school and children programmes' },
  ]

  const ministryMap = {}
  for (const m of ministryDefs) {
    const ministry = await prisma.ministry.upsert({
      where:  { name: m.name },
      update: {},
      create: { name: m.name, description: m.description, isActive: true, roles: ROLES },
    })
    ministryMap[m.name] = ministry.id
  }

  // Helper: get profile id by email
  const pid = async (email) => {
    const u = await prisma.user.findUnique({ where: { email }, include: { profile: true } })
    return u?.profile?.id ?? null
  }

  // Helper: add member to ministry (idempotent)
  const add = async (ministryName, email, role) => {
    const ministryId = ministryMap[ministryName]
    const profileId  = await pid(email)
    if (!profileId) return
    const existing = await prisma.memberMinistry.findFirst({ where: { profileId, ministryId } })
    if (existing) {
      if (existing.leftAt) {
        await prisma.memberMinistry.update({ where: { id: existing.id }, data: { leftAt: null, joinedAt: new Date(), role: role ?? null } })
      }
      return
    }
    await prisma.memberMinistry.create({ data: { profileId, ministryId, role: role ?? null } })
  }

  console.log('Assigning ministry memberships…')

  // Choir
  await add('Choir', 'faith.achieng@example.com',    'ChairPerson')
  await add('Choir', 'mary.odhiambo@example.com',    'Secretary')
  await add('Choir', 'esther.waithera@example.com',  'Treasurer')
  await add('Choir', 'susan.wanjiku@example.com',    'Coordinator')

  // Youth Ministry
  await add('Youth Ministry', 'samuel.kipchoge@example.com', 'ChairPerson')
  await add('Youth Ministry', 'faith.achieng@example.com',   'Secretary')
  await add('Youth Ministry', 'daniel.njenga@example.com',   'Coordinator')
  await add('Youth Ministry', 'susan.wanjiku@example.com',   null)

  // Women's Fellowship
  await add("Women's Fellowship", 'mary.odhiambo@example.com',    'ChairPerson')
  await add("Women's Fellowship", 'secretary@aicruiru.org',        'Secretary')
  await add("Women's Fellowship", 'esther.waithera@example.com',   'Treasurer')
  await add("Women's Fellowship", 'susan.wanjiku@example.com',     'Coordinator')
  await add("Women's Fellowship", 'faith.achieng@example.com',     null)

  // Men's Fellowship
  await add("Men's Fellowship", 'peter.musyoka@example.com',   'ChairPerson')
  await add("Men's Fellowship", 'john.kamau@example.com',       'Secretary')
  await add("Men's Fellowship", 'daniel.njenga@example.com',    'Treasurer')
  await add("Men's Fellowship", 'samuel.kipchoge@example.com',  'Coordinator')
  await add("Men's Fellowship", 'pastor@aicruiru.org',          null)
  await add("Men's Fellowship", 'admin@aicruiru.org',           null)

  // Children Ministry
  await add('Children Ministry', 'susan.wanjiku@example.com',   'ChairPerson')
  await add('Children Ministry', 'esther.waithera@example.com', 'Secretary')
  await add('Children Ministry', 'mary.odhiambo@example.com',   'Coordinator')

  // ── Content (news, announcements, events) ─────────────────────────────────
  console.log('Creating content…')

  const img = (seed, w = 800, h = 500) => `https://picsum.photos/seed/${seed}/${w}/${h}`
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
  const daysFromNow = (n, hour = 18) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0); return d }

  const adminUser = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
  })

  const contentItems = [
    // News
    {
      type: 'NEWS', category: 'General',
      title: 'Welcome to AIC Ruiru Online',
      body: '<p>We are excited to launch the new AIC Ruiru member portal! You can now view church news, upcoming events, and manage your membership profile all in one place.</p><p>If you have any feedback, please reach out to the church office.</p>',
      imageUrl: img('aicruiru1'), publishedAt: daysAgo(10),
    },
    {
      type: 'NEWS', category: 'Youth',
      title: 'Youth Camp 2025 — Registration Now Open',
      body: '<p>The annual AIC Ruiru Youth Camp is back! This year\'s theme is <strong>"Rooted and Built Up"</strong> based on Colossians 2:7.</p><ul><li>Dates: 18–21 July 2025</li><li>Venue: Brackenhurst Conference Centre, Limuru</li><li>Cost: KES 4,500 (includes accommodation &amp; meals)</li></ul><p>Register early — spaces are limited to 80 participants.</p>',
      imageUrl: img('youth2025'), publishedAt: daysAgo(5),
    },
    {
      type: 'NEWS', category: 'Missions',
      title: 'Mission Trip to Turkana — Team Update',
      body: '<p>The Missions team returned safely from a 10-day outreach to Turkana County. They distributed food packages to 240 families, held 6 open-air crusades, and partnered with the local AIC church to construct a new ablution block at the primary school.</p><p>A full photo report will be shared at the next Sunday service.</p>',
      imageUrl: img('missions2025'), publishedAt: daysAgo(14),
    },
    // Announcements
    {
      type: 'ANNOUNCEMENT', category: 'Worship',
      title: 'Sunday Service Time Change — Effective 1 June',
      body: '<p>Please note that the <strong>main Sunday service</strong> time has changed to <strong>9:00 AM</strong> to allow better preparation for church school and the second service at 11:30 AM.</p><p>Children\'s church and the Youth Service remain at their usual times.</p>',
      imageUrl: null, publishedAt: daysAgo(20),
    },
    {
      type: 'ANNOUNCEMENT', category: 'General',
      title: 'Annual General Meeting — Agenda &amp; Minutes',
      body: '<p>The 2025 Annual General Meeting was held on 24 May 2025. Key resolutions passed:</p><ul><li>Approval of the 2024 audited accounts</li><li>Election of new church board members (see attached list)</li><li>Budget approval for the new sanctuary expansion project</li></ul><p>Minutes will be available for collection at the church office from Monday.</p>',
      imageUrl: img('agm2025'), publishedAt: daysAgo(3),
    },
    // Events
    {
      type: 'EVENT', category: 'Worship',
      title: 'Night of Worship — June Edition',
      body: '<p>Join us for a powerful evening of praise and worship led by the AIC Ruiru Worship Team. Come expectant — the presence of God will be poured out!</p><p><strong>No registration required.</strong> Open to all.</p>',
      imageUrl: img('worship2025'), publishedAt: daysAgo(2),
      eventDate: daysFromNow(7), eventEndDate: daysFromNow(7, 21),
      location: 'AIC Ruiru Main Sanctuary, Ruiru Town',
      registrationOpen: false,
    },
    {
      type: 'EVENT', category: 'Youth',
      title: 'Youth Volleyball Tournament',
      body: '<p>The annual inter-church volleyball tournament is back! Teams from 8 churches will compete. Cheer on the AIC Ruiru team!</p><p>Refreshments will be on sale. Family-friendly event.</p>',
      imageUrl: img('volleyball2025'), publishedAt: daysAgo(1),
      eventDate: daysFromNow(14), eventEndDate: daysFromNow(14, 20),
      location: 'AIC Ruiru Sports Ground',
      registrationOpen: true, maxAttendees: 200,
    },
    {
      type: 'EVENT', category: 'Missions',
      title: 'Community Health Outreach — Ruiru East',
      body: '<p>Free medical camp in partnership with Ruiru Sub-County Hospital. Services offered:</p><ul><li>Blood pressure &amp; glucose screening</li><li>Eye tests</li><li>HIV testing &amp; counselling</li><li>Child immunisation (bring health cards)</li></ul><p>Volunteers needed — register below.</p>',
      imageUrl: img('healthcamp2025'), publishedAt: daysAgo(4),
      eventDate: daysFromNow(21),
      location: 'Ruiru East Primary School Grounds',
      registrationOpen: true, maxAttendees: 50,
    },
    {
      type: 'EVENT', category: 'General',
      title: 'Church Anniversary Gala Dinner',
      body: '<p>Celebrate 45 years of AIC Ruiru! An evening of thanksgiving, testimonies, and fellowship. Smart casual dress code.</p><p>Tickets: KES 1,500 per person (proceeds support the sanctuary expansion fund). Limited seats — register early.</p>',
      imageUrl: img('gala2025'), publishedAt: daysAgo(6),
      eventDate: daysFromNow(30),
      location: 'Ruiru Club, Kimbo Road',
      registrationOpen: true, maxAttendees: 120,
    },
  ]

  let contentCreated = 0, contentSkipped = 0
  for (const item of contentItems) {
    const exists = await prisma.content.findFirst({ where: { title: item.title } })
    if (exists) { contentSkipped++; continue }
    await prisma.content.create({
      data: {
        type:             item.type,
        category:         item.category ?? null,
        title:            item.title,
        body:             item.body,
        imageUrl:         item.imageUrl ?? null,
        status:           'PUBLISHED',
        publishedAt:      item.publishedAt,
        eventDate:        item.eventDate ?? null,
        eventEndDate:     item.eventEndDate ?? null,
        location:         item.location ?? null,
        maxAttendees:     item.maxAttendees ?? null,
        registrationOpen: item.registrationOpen ?? false,
        authorId:         adminUser.id,
      },
    })
    contentCreated++
  }
  console.log(`Content: ${contentCreated} created, ${contentSkipped} skipped.`)

  // ── Giving Projects ────────────────────────────────────────────
  console.log('Creating giving projects…')

  const givingProjects = [
    { name: 'Tithe',           description: 'Ten percent giving from income',          isActive: true },
    { name: 'General Offering', description: 'Regular Sunday offerings',               isActive: true },
    { name: 'Building Fund',   description: 'Contributions toward sanctuary expansion', isActive: true },
    { name: 'Missions',        description: 'Support for outreach and mission trips',   isActive: true },
  ]

  for (const p of givingProjects) {
    await prisma.givingProject.upsert({
      where:  { name: p.name },
      update: {},
      create: p,
    })
  }

  // ── Giving records ──────────────────────────────────────────────────────────
  console.log('Creating giving records…')

  const existingGivingCount = await prisma.giving.count()
  if (existingGivingCount === 0) {
    const projectIds = {}
    for (const name of ['Tithe', 'General Offering', 'Building Fund', 'Missions']) {
      const p = await prisma.givingProject.findUnique({ where: { name } })
      if (p) projectIds[name] = p.id
    }

    const recorder = adminUser

    const givingMembers = [
      'john.kamau@example.com', 'mary.odhiambo@example.com', 'peter.musyoka@example.com',
      'samuel.kipchoge@example.com', 'faith.achieng@example.com', 'daniel.njenga@example.com',
      'esther.waithera@example.com', 'susan.wanjiku@example.com',
    ]
    const memberProfiles = {}
    for (const email of givingMembers) {
      const u = await prisma.user.findUnique({ where: { email }, include: { profile: true } })
      if (u?.profile) memberProfiles[email] = u.profile.id
    }

    const dAgo = (n, h = 10) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d }

    const givings = [
      // John Kamau — regular giver
      { email: 'john.kamau@example.com', project: 'Tithe',            amount: 5000,  method: 'MPESA',         ref: 'QGH2345ABC', givenAt: dAgo(2) },
      { email: 'john.kamau@example.com', project: 'General Offering', amount: 500,   method: 'CASH',          ref: null,         givenAt: dAgo(2) },
      { email: 'john.kamau@example.com', project: 'Building Fund',    amount: 2000,  method: 'BANK_TRANSFER', ref: 'TRF-00412',  givenAt: dAgo(16) },
      { email: 'john.kamau@example.com', project: 'Tithe',            amount: 5000,  method: 'MPESA',         ref: 'RDF9871KLM', givenAt: dAgo(30) },
      { email: 'john.kamau@example.com', project: 'General Offering', amount: 500,   method: 'CASH',          ref: null,         givenAt: dAgo(30) },
      // Mary Odhiambo
      { email: 'mary.odhiambo@example.com', project: 'Tithe',            amount: 3500,  method: 'MPESA',  ref: 'LKP4512XYZ', givenAt: dAgo(2) },
      { email: 'mary.odhiambo@example.com', project: 'Missions',         amount: 1000,  method: 'CASH',   ref: null,         givenAt: dAgo(9) },
      { email: 'mary.odhiambo@example.com', project: 'General Offering', amount: 300,   method: 'CASH',   ref: null,         givenAt: dAgo(30) },
      // Peter Musyoka
      { email: 'peter.musyoka@example.com', project: 'Tithe',            amount: 8000,  method: 'MPESA',         ref: 'MPZ7788QRS', givenAt: dAgo(3) },
      { email: 'peter.musyoka@example.com', project: 'Building Fund',    amount: 5000,  method: 'BANK_TRANSFER', ref: 'TRF-00398',  givenAt: dAgo(10) },
      { email: 'peter.musyoka@example.com', project: 'Missions',         amount: 2000,  method: 'MPESA',         ref: 'MPZ8801TUV', givenAt: dAgo(45) },
      // Samuel Kipchoge
      { email: 'samuel.kipchoge@example.com', project: 'Tithe',            amount: 4200,  method: 'MPESA', ref: 'NKQ3390WXY', givenAt: dAgo(2) },
      { email: 'samuel.kipchoge@example.com', project: 'General Offering', amount: 400,   method: 'CASH',  ref: null,         givenAt: dAgo(2) },
      // Faith Achieng
      { email: 'faith.achieng@example.com',   project: 'Tithe',            amount: 1800,  method: 'MPESA', ref: 'PKS6634DEF', givenAt: dAgo(2) },
      { email: 'faith.achieng@example.com',   project: 'Building Fund',    amount: 500,   method: 'CASH',  ref: null,         givenAt: dAgo(16) },
      // Daniel Njenga
      { email: 'daniel.njenga@example.com',   project: 'Tithe',            amount: 6500,  method: 'MPESA',         ref: 'QRS1145GHI', givenAt: dAgo(2) },
      { email: 'daniel.njenga@example.com',   project: 'Missions',         amount: 3000,  method: 'BANK_TRANSFER', ref: 'TRF-00422',  givenAt: dAgo(20) },
      // Esther Waithera
      { email: 'esther.waithera@example.com', project: 'Tithe',            amount: 2200,  method: 'MPESA', ref: 'STU2256JKL', givenAt: dAgo(2) },
      { email: 'esther.waithera@example.com', project: 'General Offering', amount: 200,   method: 'CASH',  ref: null,         givenAt: dAgo(2) },
      // Susan Wanjiku
      { email: 'susan.wanjiku@example.com',   project: 'Tithe',            amount: 2800,  method: 'MPESA', ref: 'VWX3367MNO', givenAt: dAgo(2) },
      { email: 'susan.wanjiku@example.com',   project: 'Building Fund',    amount: 1000,  method: 'CASH',  ref: null,         givenAt: dAgo(30) },
    ]

    for (const g of givings) {
      const profileId = memberProfiles[g.email]
      if (!profileId || !projectIds[g.project]) continue
      await prisma.giving.create({
        data: {
          memberId:      profileId,
          isAnonymous:   false,
          projectId:     projectIds[g.project],
          amount:        g.amount,
          paymentMethod: g.method,
          reference:     g.ref ?? null,
          givenAt:       g.givenAt,
          recordedById:  recorder.id,
        },
      })
    }

    // Anonymous giving (no member linked)
    await prisma.giving.create({
      data: {
        memberId:      null,
        isAnonymous:   true,
        projectId:     projectIds['General Offering'],
        amount:        10000,
        paymentMethod: 'CASH',
        reference:     null,
        note:          'Envelope offering — name withheld at donor request',
        givenAt:       dAgo(2),
        recordedById:  recorder.id,
      },
    })

    // Anonymous giving with known member (stored in DB but masked to non-super-admin)
    if (memberProfiles['peter.musyoka@example.com']) {
      await prisma.giving.create({
        data: {
          memberId:      memberProfiles['peter.musyoka@example.com'],
          isAnonymous:   true,
          projectId:     projectIds['Building Fund'],
          amount:        50000,
          paymentMethod: 'BANK_TRANSFER',
          reference:     'TRF-ANON-01',
          note:          'Donor requested anonymity',
          givenAt:       dAgo(5),
          recordedById:  recorder.id,
        },
      })
    }

    // Voided giving (duplicate entry that was corrected)
    if (memberProfiles['john.kamau@example.com']) {
      const adminUser2 = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
      await prisma.giving.create({
        data: {
          memberId:      memberProfiles['john.kamau@example.com'],
          isAnonymous:   false,
          projectId:     projectIds['Tithe'],
          amount:        5000,
          paymentMethod: 'MPESA',
          reference:     'QGH2345ABC',
          note:          'DUPLICATE — voided',
          givenAt:       dAgo(2),
          recordedById:  recorder.id,
          voided:        true,
          voidedAt:      dAgo(1),
          voidedById:    adminUser2?.id ?? recorder.id,
        },
      })
    }

    console.log(`Givings: ${givings.length + 3} created.`)
  } else {
    console.log(`Givings: skipped (${existingGivingCount} records already exist).`)
  }

  console.log('\n✓ Seed complete\n')
  console.log('Test credentials — password for all: Test1234!\n')
  console.log('  SUPER_ADMIN  admin@aicruiru.org')
  console.log('  ADMIN        pastor@aicruiru.org')
  console.log('  STAFF        secretary@aicruiru.org')
  console.log('  MEMBER       john.kamau@example.com')
  console.log('  PENDING      kevin.otieno@example.com')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
