import { cacheInvalidate, cacheInvalidatePrefix } from '../../services/cache.js'

export function invalidateMemberLists() {
  cacheInvalidatePrefix('members:list:')
  cacheInvalidate('members:pending', 'members:slim')
}

// Full include — for getMe and getMember (individual detail view)
export const profileInclude = {
  profile: {
    include: {
      household: true,
      ministries: { include: { ministry: true } },
      statusHistory: { orderBy: { changedAt: 'desc' }, take: 5 },
    },
  },
}

// Light include — for list queries (no ministry joins; table doesn't show them)
export const profileIncludeList = {
  profile: {
    include: {
      household: true,
    },
  },
}

// Fields a member may request a change to. Church-record fields (membershipStatus,
// householdId, baptismDate, dateJoined, photoUrl) are admin-only via updateMember.
export const REQUESTABLE_PROFILE_FIELDS = ['firstName', 'lastName', 'middleName', 'phone', 'address', 'dateOfBirth']

export function formatMember(user) {
  const p = user.profile
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    profile: p ? {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      middleName: p.middleName,
      fullName: `${p.firstName} ${p.lastName}`,
      dateOfBirth: p.dateOfBirth,
      phone: p.phone,
      address: p.address,
      dateJoined: p.dateJoined,
      baptismDate: p.baptismDate,
      membershipStatus: p.membershipStatus,
      photoUrl: p.photoUrl,
      household: p.household ? { id: p.household.id, name: p.household.name } : null,
      ministries: p.ministries?.map(m => ({ id: m.ministry.id, name: m.ministry.name, role: m.role })) ?? [],
      statusHistory: p.statusHistory ?? [],
    } : null,
  }
}
