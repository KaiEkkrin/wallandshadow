import { eq } from 'drizzle-orm';
import { UserLevel } from '@wallandshadow/shared';
import { users } from '../db/schema.js';
import type { Db } from '../db/connection.js';
import { logger } from './logger.js';
import { notifyUserProfile, notifySafe } from '../ws/notify.js';

// Bootstrap-only path for granting the first admin tier without a manual SQL
// step. ADMIN_USER_ID is the OIDC subject of the single account that should
// be auto-promoted to admin; intentionally separate from updateUserLevel()
// because there is no acting admin user at boot and the last-admin guard is
// not relevant.

export function getConfiguredAdminSub(): string | undefined {
  const sub = process.env.ADMIN_USER_ID?.trim();
  return sub ? sub : undefined;
}

export async function ensureAdminUser(db: Db): Promise<void> {
  const sub = getConfiguredAdminSub();
  if (!sub) return;
  try {
    const [row] = await db.select({ id: users.id, level: users.level })
      .from(users)
      .where(eq(users.providerSub, sub))
      .limit(1);
    if (!row) {
      logger.logWarning(
        `ADMIN_USER_ID=${sub} set but no matching user yet — they will be promoted on first sign-in.`,
      );
      return;
    }
    if (row.level === UserLevel.Admin) {
      logger.logInfo(`Admin user ${row.id} already at admin tier.`);
      return;
    }
    await db.update(users)
      .set({ level: UserLevel.Admin })
      .where(eq(users.id, row.id));
    await notifySafe(notifyUserProfile(row.id));
    logger.logInfo(`Promoted user ${row.id} to admin via ADMIN_USER_ID.`);
  } catch (e) {
    logger.logError('ensureAdminUser failed', e);
  }
}
