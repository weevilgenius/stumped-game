import { parseChangelog, releasesAfter, renderChangelog } from './changelog';

describe('release notes', () => {
  it('reads CRLF headings and sorts versions numerically, retaining release bodies', () => {
    const releases = parseChangelog('# Changelog\r\n\r\n## 1.9.0\r\n- Older\r\n\r\n## 1.10.0\r\n### Fixed\r\n- Newer\r\n');
    expect(releases).toEqual([
      { version: '1.10.0', body: '### Fixed\r\n- Newer' },
      { version: '1.9.0', body: '- Older' },
    ]);
  });

  it('shows all skipped releases while excluding the running version and older ones', () => {
    const releases = parseChangelog('## 2.0.0\n- Major\n## 1.10.0\n- Minor\n## 1.9.1\n- Patch\n## 1.9.0\n- Current\n## 1.8.0\n- Old');
    expect(releasesAfter(releases, '1.9.0').map((release) => release.version)).toEqual(['2.0.0', '1.10.0', '1.9.1']);
    expect(releasesAfter(releases, '2.0.0')).toEqual([]);
    expect(parseChangelog('<html>Not a changelog</html>')).toEqual([]);
  });

  it('renders basic Markdown as text without interpreting HTML', () => {
    const container = document.createElement('div');
    renderChangelog(container, parseChangelog('## 1.0.0\nA paragraph\ncontinued.\n\n### Fixed\n- <img src=x onerror=alert(1)>\n- Another fix'));
    expect(container.querySelector('h3')?.textContent).toBe('1.0.0');
    expect(container.querySelector('h4')?.textContent).toBe('Fixed');
    expect(container.querySelector('p')?.textContent).toBe('A paragraph continued.');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    renderChangelog(container, []);
    expect(container.textContent).toBe('No release notes for this update.');
  });
});
