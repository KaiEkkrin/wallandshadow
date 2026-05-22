import { describe, it, expect } from 'vitest';

import { injectThirdPartyNotices } from '../../src/utils/thirdPartyNotices';
import { renderNoticesMarkdown, type LicenseRecord } from '../../vite-plugins/third-party-notices';

describe('injectThirdPartyNotices', () => {
  const doc = [
    '# Title',
    '',
    '## Third-party notices',
    '',
    '<!-- THIRD-PARTY-NOTICES:START — generated, do not edit -->',
    '',
    '_Placeholder._',
    '',
    '<!-- THIRD-PARTY-NOTICES:END -->',
    '',
    '## Fonts',
  ].join('\n');

  it('replaces the delimiter block, comment wrappers included', () => {
    const result = injectThirdPartyNotices(doc, 'GENERATED');
    expect(result).toContain('## Third-party notices\n\nGENERATED\n\n## Fonts');
    // Placeholder, markers, and comment wrappers are all gone.
    expect(result).not.toContain('THIRD-PARTY-NOTICES');
    expect(result).not.toContain('Placeholder');
    expect(result).not.toContain('<!--');
  });

  it('throws when the delimiters are absent', () => {
    expect(() => injectThirdPartyNotices('# No markers here', 'X')).toThrow(/delimiters not found/);
  });
});

describe('renderNoticesMarkdown', () => {
  const mitText = 'MIT License\n\nPermission is hereby granted, free of charge...';
  const iscText = 'ISC License\n\nPermission to use, copy, modify...';

  const records: LicenseRecord[] = [
    { name: 'beta', version: '1.0.0', licenseId: 'MIT', repository: 'https://example.com/beta', licenseText: mitText },
    { name: 'alpha', version: '2.0.0', licenseId: 'MIT', repository: undefined, licenseText: mitText },
    { name: 'gamma', version: '3.0.0', licenseId: 'ISC', repository: 'https://example.com/gamma', licenseText: iscText },
  ];

  it('lists every package, sorted by name, with optional source links', () => {
    const md = renderNoticesMarkdown(records);
    expect(md).toContain('- **alpha** 2.0.0 — MIT\n');
    // Repository URLs are wrapped in <> so ')' / spaces can't break the link.
    expect(md).toContain('- **beta** 1.0.0 — MIT — [source](<https://example.com/beta>)');
    expect(md).toContain('- **gamma** 3.0.0 — ISC');
    expect(md.indexOf('**alpha**')).toBeLessThan(md.indexOf('**beta**'));
    expect(md.indexOf('**beta**')).toBeLessThan(md.indexOf('**gamma**'));
  });

  it('emits each distinct licence text once and counts them', () => {
    const md = renderNoticesMarkdown(records);
    expect(md).toContain('3 packages, 2 distinct licences');
    // The shared MIT text is printed once even though two packages use it.
    expect(md.split('Permission is hereby granted').length - 1).toBe(1);
  });

  it('picks a code fence longer than any backtick run in the licence text', () => {
    const tricky: LicenseRecord[] = [
      { name: 'x', version: '1.0.0', licenseId: 'MIT', repository: undefined, licenseText: 'see ```code``` block' },
    ];
    const md = renderNoticesMarkdown(tricky);
    // The text contains a run of 3 backticks, so the fence must be 4.
    expect(md).toContain('````');
  });
});
