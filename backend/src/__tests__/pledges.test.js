import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../app.js'
import prisma from '../config/db.js'
import { testEmail, testPhone, createTestUser, tokenFor, cleanup } from './helpers.js'

vi.mock('../services/email.js', () => ({
  sendOtpEmail:                   vi.fn().mockResolvedValue(undefined),
  sendAdminNewMemberNotification: vi.fn().mockResolvedValue(undefined),
  sendApprovalEmail:              vi.fn().mockResolvedValue(undefined),
  sendRejectionEmail:             vi.fn().mockResolvedValue(undefined),
  sendInviteEmail:                vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail:         vi.fn().mockResolvedValue(undefined),
}))

const api = request(app)

let staffGivings, member, member2
let staffToken, memberToken, member2Token
let project
let priorFeatureSetting

beforeAll(async () => {
  priorFeatureSetting = await prisma.siteSetting.findUnique({ where: { key: 'givings_enabled' } })
  await prisma.siteSetting.upsert({
    where: { key: 'givings_enabled' }, update: { value: true },
    create: { key: 'givings_enabled', value: true },
  })

  ;[staffGivings, member, member2] = await Promise.all([
    createTestUser({ role: 'STAFF', firstName: 'Pledge', lastName: 'Staff', email: testEmail('pledge-staff'), phone: testPhone() }),
    createTestUser({ role: 'MEMBER', firstName: 'Pledge', lastName: 'Member' }),
    createTestUser({ role: 'MEMBER', firstName: 'Pledge', lastName: 'Member2' }),
  ])
  await prisma.user.update({ where: { id: staffGivings.id }, data: { permissions: { manageGivings: true } } })
  staffGivings = await prisma.user.findUnique({ where: { id: staffGivings.id } })

  ;[{ accessToken: staffToken }, { accessToken: memberToken }, { accessToken: member2Token }] =
    await Promise.all([tokenFor(staffGivings), tokenFor(member), tokenFor(member2)])

  project = await prisma.givingProject.create({ data: { name: `Pledge Project ${testPhone()}`, isActive: true } })
})

afterAll(async () => {
  const profileIds = [member.profile.id, member2.profile.id]
  const userIds = [staffGivings.id, member.id, member2.id]
  await prisma.pledge.deleteMany({ where: { OR: [{ memberId: { in: profileIds } }, { createdById: { in: userIds } }] } })
  await prisma.giving.deleteMany({ where: { recordedById: { in: userIds } } })
  await prisma.givingProject.deleteMany({ where: { id: project.id } })
  await cleanup(staffGivings.email, member.email, member2.email)

  if (priorFeatureSetting) {
    await prisma.siteSetting.update({ where: { key: 'givings_enabled' }, data: { value: priorFeatureSetting.value } })
  } else {
    await prisma.siteSetting.delete({ where: { key: 'givings_enabled' } }).catch(() => {})
  }
})

describe('Pledges', () => {
  it('201 — member creates a self-pledge', async () => {
    const res = await api.post('/api/givings/pledges')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ projectId: project.id, totalAmount: 12000, months: 12 })
    expect(res.status).toBe(201)
    expect(res.body.memberId).toBe(member.profile.id)
    expect(res.body.monthlyExpected).toBe('1000.00')
    expect(res.body.fulfilled).toBe('0.00')
    expect(res.body.percent).toBe(0)
  })

  it('201 — manager creates a pledge for another member', async () => {
    const res = await api.post('/api/givings/pledges')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ memberId: member2.profile.id, projectId: project.id, totalAmount: 6000, months: 6 })
    expect(res.status).toBe(201)
    expect(res.body.memberId).toBe(member2.profile.id)
  })

  it('403 — member cannot create a pledge for someone else', async () => {
    const res = await api.post('/api/givings/pledges')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ memberId: member2.profile.id, projectId: project.id, totalAmount: 1000, months: 2 })
    expect(res.status).toBe(403)
  })

  it('progress reflects recorded givings to the project', async () => {
    await api.post('/api/givings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ memberId: member.profile.id, projectId: project.id, amount: 3000, paymentMethod: 'CASH' })

    const res = await api.get('/api/givings/pledges/mine').set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    const pledge = res.body.pledges.find(p => p.projectId === project.id)
    expect(pledge.fulfilled).toBe('3000.00')
    expect(pledge.percent).toBe(25)
  })

  it('GET /pledges/mine only returns the caller\'s pledges', async () => {
    const res = await api.get('/api/givings/pledges/mine').set('Authorization', `Bearer ${member2Token}`)
    expect(res.status).toBe(200)
    expect(res.body.pledges.every(p => p.memberId === member2.profile.id)).toBe(true)
  })

  it('403 — member cannot list all pledges', async () => {
    const res = await api.get('/api/givings/pledges').set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })

  it('200 — manager lists all pledges with progress', async () => {
    const res = await api.get('/api/givings/pledges').set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(res.body.pledges.length).toBeGreaterThanOrEqual(2)
  })

  it('owner can cancel their pledge', async () => {
    const list = await api.get('/api/givings/pledges/mine').set('Authorization', `Bearer ${memberToken}`)
    const id = list.body.pledges[0].id
    const res = await api.patch(`/api/givings/pledges/${id}/cancel`).set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CANCELLED')
  })

  it('404 — pledges hidden when givings feature is disabled', async () => {
    await prisma.siteSetting.update({ where: { key: 'givings_enabled' }, data: { value: false } })
    const res = await api.get('/api/givings/pledges/mine').set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(404)
    await prisma.siteSetting.update({ where: { key: 'givings_enabled' }, data: { value: true } })
  })
})
