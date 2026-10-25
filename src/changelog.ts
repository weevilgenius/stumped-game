/** One release introduced by a `## major.minor.patch` Markdown heading. */
export interface ReleaseNotes {
  /** Numeric release version. */
  readonly version: string;
  /** Markdown below the release heading. */
  readonly body: string;
}

const compareVersions = (left: string, right: string): number => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};

/** Splits a simple Markdown changelog into releases, newest first. */
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const headings = [...markdown.matchAll(/^## (\d+\.\d+\.\d+)\s*$/gm)];
  return headings.map((heading, index) => ({
    version: heading[1],
    body: markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim(),
  })).sort((left, right) => compareVersions(right.version, left.version));
}

/** Selects every release newer than the version still running in the page. */
export function releasesAfter(releases: readonly ReleaseNotes[], version: string): ReleaseNotes[] {
  return releases.filter((release) => compareVersions(release.version, version) > 0);
}

/** Renders release headings, paragraphs, subheadings and bullets as safe DOM text. */
export function renderChangelog(container: HTMLElement, releases: readonly ReleaseNotes[]): void {
  container.replaceChildren();
  if (!releases.length) {
    container.textContent = 'No release notes for this update.';
    return;
  }
  const document = container.ownerDocument;
  for (const release of releases) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = release.version;
    section.append(heading);
    let paragraph: HTMLParagraphElement | null = null;
    let list: HTMLUListElement | null = null;
    for (const line of release.body.split(/\r?\n/)) {
      const bullet = /^\s*[-*] (.*)$/.exec(line);
      const subheading = /^#{3,6} (.*)$/.exec(line);
      if (bullet) {
        if (!list) {
          list = document.createElement('ul');
          section.append(list);
        }
        const item = document.createElement('li');
        item.textContent = bullet[1];
        list.append(item);
        paragraph = null;
      } else {
        list = null;
        if (subheading) {
          const title = document.createElement('h4');
          title.textContent = subheading[1];
          section.append(title);
          paragraph = null;
        } else if (line.trim()) {
          if (!paragraph) {
            paragraph = document.createElement('p');
            section.append(paragraph);
          }
          paragraph.textContent += `${paragraph.textContent ? ' ' : ''}${line.trim()}`;
        } else {
          paragraph = null;
        }
      }
    }
    container.append(section);
  }
}
