import { Link } from 'react-router-dom';
import Markdown, { type Components } from 'react-markdown';

import './About.css';

import Navigation from './components/Navigation';
import { useDocumentTitle } from './hooks/useDocumentTitle';

import aboutMd from './content/about/about.md?raw';
import acknowledgementsMd from './content/about/acknowledgements.md?raw';
import privacyMd from './content/about/privacy.md?raw';
import termsMd from './content/about/terms.md?raw';

export type AboutPageName = 'about' | 'privacy' | 'terms' | 'acknowledgements';

interface IAboutDocument {
  readonly title: string;
  readonly markdown: string;
}

// react-markdown renders raw HTML — including comments — as visible text rather
// than dropping it. Strip HTML comments so build-step markers (e.g. the
// THIRD-PARTY-NOTICES delimiters in acknowledgements.md) stay in the source
// files for later tooling but never show on the page.
function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, '');
}

const aboutDocuments: Record<AboutPageName, IAboutDocument> = {
  about: { title: 'About', markdown: stripHtmlComments(aboutMd) },
  privacy: { title: 'Privacy Notice', markdown: stripHtmlComments(privacyMd) },
  terms: { title: 'Terms of Service', markdown: stripHtmlComments(termsMd) },
  acknowledgements: {
    title: 'Open-source acknowledgements',
    markdown: stripHtmlComments(acknowledgementsMd),
  },
};

// The source documents link to each other with relative filenames (e.g.
// `privacy.md`, `terms.md#acceptable-use`). Map those onto the in-app routes so
// the links navigate within the SPA rather than triggering a full page load.
const documentRoutes: Record<string, string> = {
  'about.md': '/about',
  'privacy.md': '/about/privacy',
  'terms.md': '/about/terms',
  'acknowledgements.md': '/about/acknowledgements',
};

function resolveInternalHref(href: string): string | undefined {
  const match = /^([^/#]+\.md)(#.*)?$/.exec(href);
  if (match === null) {
    return undefined;
  }

  const route = documentRoutes[match[1]];
  return route === undefined ? undefined : `${route}${match[2] ?? ''}`;
}

const markdownComponents: Components = {
  a({ href, title, children }) {
    const internalHref = href === undefined ? undefined : resolveInternalHref(href);
    if (internalHref !== undefined) {
      return (
        <Link to={internalHref} title={title}>
          {children}
        </Link>
      );
    }

    return (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

interface IAboutProps {
  page: AboutPageName;
}

function About({ page }: IAboutProps) {
  const document = aboutDocuments[page];
  useDocumentTitle(document.title);

  return (
    <div>
      <Navigation />
      <div className="About-page">
        <article className="About-content">
          <Markdown components={markdownComponents}>{document.markdown}</Markdown>
        </article>
      </div>
    </div>
  );
}

export default About;
