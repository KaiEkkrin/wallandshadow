import { useCallback, useState } from 'react';

import MapInfoCard from './MapInfoCard';

import Button from 'react-bootstrap/Button';
import ListGroup from 'react-bootstrap/ListGroup';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faNetworkWired } from '@fortawesome/free-solid-svg-icons';

import type { NetworkStatus as NetworkStatusType } from '../models/networkStatusTracker';

export interface INetworkStatusProps {
  status: NetworkStatusType;
  isConnected: boolean;
  rttAverage: number | null;
  resyncCount: number;
  reconnectCount: number;
  onForceReconnect: () => void;
}

function NetworkStatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ListGroup.Item className="Map-info-list-item">
      <div className="Map-network-status-item">
        <div>{label}</div>
        <div className="ms-2">{children}</div>
      </div>
    </ListGroup.Item>
  );
}

function NetworkStatus({ status, isConnected, rttAverage, resyncCount, reconnectCount, onForceReconnect }: INetworkStatusProps) {
  const [reconnectDisabled, setReconnectDisabled] = useState(false);

  const handleReconnect = useCallback(() => {
    setReconnectDisabled(true);
    onForceReconnect();
    setTimeout(() => setReconnectDisabled(false), 3000);
  }, [onForceReconnect]);

  return (
    <MapInfoCard title="Network Status" bg={status} buttonContent={(
      <FontAwesomeIcon icon={faNetworkWired} color="white" />
    )}>
      <ListGroup variant="flush">
        <NetworkStatRow label="Connection">
          <span className={`text-${isConnected ? 'success' : 'danger'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </NetworkStatRow>
        <NetworkStatRow label="Avg RTT">
          {rttAverage !== null ? `${rttAverage}ms` : '—'}
        </NetworkStatRow>
        <NetworkStatRow label="Recent reconnections">
          {reconnectCount}
        </NetworkStatRow>
        <NetworkStatRow label="Recent resyncs">
          {resyncCount}
        </NetworkStatRow>
      </ListGroup>
      {!isConnected && (
        <div className="p-2">
          <Button variant="warning" size="sm" disabled={reconnectDisabled} onClick={handleReconnect}>
            Reconnect now
          </Button>
        </div>
      )}
    </MapInfoCard>
  );
}

export default NetworkStatus;
