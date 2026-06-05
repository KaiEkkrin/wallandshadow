import './VersionBadge.css';
import { Link } from 'react-router-dom';
import packageJson from '../../package.json';

function VersionBadge() {
  const versionString = `v${packageJson.version}+${__GIT_COMMIT__}`;

  return (
    <div className="version-badge">
      <Link to="/about" className="version-badge-link">About</Link>
      {' | '}
      <a
        href="https://github.com/KaiEkkrin/wallandshadow"
        className="version-badge-link"
        target="_blank"
        rel="noopener noreferrer"
        title="View on GitHub"
      >
        {versionString}
      </a>
    </div>
  );
}

export default VersionBadge;
