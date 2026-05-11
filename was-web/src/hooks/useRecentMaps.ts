import { useEffect, useState } from 'react';
import type { IMapSummary } from '@wallandshadow/shared';
import { readRecentMaps, recentMaps$ } from '../services/recentMaps';

export function useRecentMaps(uid: string | undefined): IMapSummary[] {
  const [maps, setMaps] = useState<IMapSummary[]>(
    uid ? readRecentMaps(uid) : []
  );

  useEffect(() => {
    if (!uid) {
      setMaps([]);
      return;
    }
    const sub = recentMaps$(uid).subscribe(setMaps);
    return () => sub.unsubscribe();
  }, [uid]);

  return maps;
}
