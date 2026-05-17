import { DELETED_USER_LABEL, userNameText } from './userNameText';

export function UserName({ name }: { name: string | null | undefined }) {
  const text = userNameText(name);
  if (text === DELETED_USER_LABEL) {
    return <em className="text-muted">{text}</em>;
  }
  return <>{text}</>;
}
