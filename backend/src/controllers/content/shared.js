const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'LEGEND'])

// Returns false when a Staff user has only manageEvents and the content type is not EVENT.
export function canManageItemType(user, itemType) {
  if (ADMIN_ROLES.has(user.role)) return true
  if (user.permissions?.manageContent) return true
  if (user.permissions?.manageEvents && itemType === 'EVENT') return true
  return false
}

export function formatItem(item, isNew) {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    title: item.title,
    body: item.body,
    imageUrl: item.imageUrl,
    category: item.category,
    isFeatured: item.isFeatured,
    eventDate: item.eventDate,
    eventEndDate: item.eventEndDate,
    location: item.location,
    maxAttendees: item.maxAttendees,
    registrationOpen: item.registrationOpen,
    ticketPrice: item.ticketPrice,
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    author: item.author ? {
      id: item.author.id,
      email: item.author.email,
      name: item.author.profile ? `${item.author.profile.firstName} ${item.author.profile.lastName}` : item.author.email,
    } : undefined,
    isNew: isNew,
  }
}
