export function validateConfig (config: any): void {
  const admins = config.server?.auth?.admins;
  if (admins !== undefined && !(
    Array.isArray(admins) && admins.every(login => typeof login === 'string' && login)
  )) {
    throw new Error('server.auth.admins must be a list of logins');
  }
  const maxSize = config.server?.attachments?.maxSize;
  if (maxSize !== undefined && !(typeof maxSize === 'number' && maxSize > 0)) {
    throw new Error('server.attachments.maxSize must be a positive number');
  }
}
