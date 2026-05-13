export const DELETED_USER_LABEL = 'Deleted user';

export function userNameText(name: string | null | undefined): string {
  return name === null || name === undefined || name === '' ? DELETED_USER_LABEL : name;
}
