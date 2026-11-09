export function validateConfig (config: any): void {
  const admins = config.server?.auth?.admins;
  if (admins !== undefined && !(
    Array.isArray(admins) && admins.every(login => typeof login === 'string' && login)
  )) {
    throw new Error('server.auth.admins must be a list of logins');
  }
}
