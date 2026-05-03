import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faNetworkWired } from '@fortawesome/free-solid-svg-icons';

import type { NetworkStatus } from '../models/networkStatusTracker';

const STATUS_COLOUR: Record<NetworkStatus, string> = {
  success: 'var(--bs-success)',
  warning: 'var(--bs-warning)',
  danger: 'var(--bs-danger)',
};

export interface INetworkStatusBadgeProps {
  status: NetworkStatus;
  isConnected: boolean;
  rttAverage: number | null;
  reconnectCount: number;
}

function NetworkStatusBadge({ status, isConnected, rttAverage, reconnectCount }: INetworkStatusBadgeProps) {
  let tooltipText: string;
  if (!isConnected) {
    tooltipText = 'Disconnected';
  } else {
    const rttPart = rttAverage !== null ? `Avg RTT: ${rttAverage}ms` : 'Avg RTT: —';
    const reconnectPart = reconnectCount > 0
      ? ` · ${reconnectCount} reconnection${reconnectCount === 1 ? '' : 's'}`
      : '';
    tooltipText = `Connected · ${rttPart}${reconnectPart}`;
  }

  return (
    <OverlayTrigger placement="bottom" overlay={
      <Tooltip id="network-status-badge-tooltip">{tooltipText}</Tooltip>
    }>
      <span style={{ cursor: 'default' }}>
        <FontAwesomeIcon icon={faNetworkWired} color={STATUS_COLOUR[status]} />
      </span>
    </OverlayTrigger>
  );
}

export default NetworkStatusBadge;
