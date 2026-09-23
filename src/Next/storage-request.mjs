export function promptsForPersistence(userAgent) {
  return /Firefox\//.test(userAgent || '') && !/FxiOS\//.test(userAgent || '');
}

export function persistenceAction({ userAgent, explained = false, alreadyAsked = false }) {
  if (alreadyAsked) return 'none';
  if (promptsForPersistence(userAgent) && !explained) return 'observe';
  return 'request';
}
