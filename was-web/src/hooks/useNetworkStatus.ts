import { useEffect, useState } from 'react';
import { networkStatusTracker, type NetworkStatus } from '../models/networkStatusTracker';

export interface NetworkStatusState {
  status: NetworkStatus;
  isConnected: boolean;
  rttAverage: number | null;
  reconnectCount: number;
}

export function useNetworkStatus(): NetworkStatusState {
  const [status, setStatus] = useState<NetworkStatus>('success');
  const [isConnected, setIsConnected] = useState(false);
  const [rttAverage, setRttAverage] = useState<number | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  useEffect(() => {
    const subs = [
      networkStatusTracker.status$.subscribe(setStatus),
      networkStatusTracker.isConnected$.subscribe(setIsConnected),
      networkStatusTracker.rttAverage$.subscribe(setRttAverage),
      networkStatusTracker.reconnectCount$.subscribe(setReconnectCount),
    ];
    return () => { subs.forEach(s => s.unsubscribe()); };
  }, []);

  return { status, isConnected, rttAverage, reconnectCount };
}
