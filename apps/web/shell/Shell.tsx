// The app shell every screen mounts into, ported from classic src/Next/Product.fs `view` (root, preview strip,
// header, tagline, faces area, footer) and src/App.fs (`header`, `ThemedApp`). The `.next-*` DOM and class
// contract is kept; screens render into the faces area.
import GitHubIcon from '@mui/icons-material/GitHub';
import CssBaseline from '@mui/material/CssBaseline';
import Link from '@mui/material/Link';
import SvgIcon from '@mui/material/SvgIcon';
import { ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { DragEvent, ReactNode } from 'react';
import AnimatedLogo from '../src/public/logo-animated.svg?react';
import Logo from '../src/public/logo.svg?react';
import { photoFiles } from '../src/Next/photo-selection.mjs';
import { CONTACT_EMAIL, GITHUB_REPO, SITE_NAME, issueUrl, sourceVersion } from './links.ts';
import { darkTheme, lightTheme } from './theme.ts';

export function ThemedApp({ children }: { children: ReactNode }) {
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  return (
    <ThemeProvider theme={dark ? darkTheme : lightTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export function Header() {
  return (
    <header style={{ marginBottom: '2em' }}>
      <div className="column">
        <a href="/">
          <h1
            className="title "
            style={{
              fontSize: 'clamp(2.5rem, 12vw, 4rem)',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '0.5em',
            }}
          >
            <SvgIcon
              className="vivus-start"
              component={AnimatedLogo}
              inheritViewBox
              style={{ fontSize: '1em' }}
            />
            <span>{SITE_NAME}</span>
          </h1>
        </a>
      </div>
    </header>
  );
}

export function PreviewStrip({ route = '' }: { route?: string }) {
  return (
    <aside className="next-preview-strip" role="note" aria-label="About this preview">
      <span className="next-preview-strip-lead">
        <strong>Experimental preview</strong> of the next facemorph.me. Everything runs on your
        device.
      </span>
      <span className="next-preview-strip-links">
        <a href="https://facemorph.me">Classic facemorph.me</a>
        <a href="https://facemorph.me/retirement">Its server is retiring</a>
        <a href={issueUrl({ route })} target="_blank" rel="noopener">
          Report an issue
        </a>
      </span>
    </aside>
  );
}

export function Footer({ route = '' }: { route?: string }) {
  return (
    <footer className="next-footer">
      <div className="next-footer-inner">
        <div className="next-footer-text">
          <p>
            Contact:{' '}
            <Link color="inherit" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </Link>
          </p>
          <p>
            Source code:{' '}
            <Link color="inherit" href={`https://github.com/${GITHUB_REPO}`}>
              <GitHubIcon style={{ fontSize: '1em' }} />
              {` ${GITHUB_REPO}`}
            </Link>
          </p>
          <p>
            Found a problem?{' '}
            <Link color="inherit" href={issueUrl({ route })} target="_blank" rel="noopener">
              Report an issue
            </Link>{' '}
            — it fills in your version and device.
          </p>
          <p className="next-footer-version">Preview version {sourceVersion()}</p>
        </div>
        <div className="next-footer-logo">
          <SvgIcon component={Logo} inheritViewBox style={{ fontSize: '5rem' }} />
        </div>
      </div>
    </footer>
  );
}

export interface ShellProps {
  /** Whether a job is running (`data-next-busy`). */
  readonly busy?: boolean;
  /** The processing route shown in issue links, once one has run. */
  readonly route?: string;
  /** How many faces the faces area holds (`data-next-faces`). */
  readonly faces?: number;
  /** Files dropped on the page background, in drop order: they fill the first empty face, then append. */
  readonly onDropFiles?: (files: File[]) => void;
  /** Overlays the screens render between the preview strip and the header (the face picker). */
  readonly overlay?: ReactNode;
  /** What the screens render after the tagline (the invite) and inside the faces area. */
  readonly intro?: ReactNode;
  readonly children?: ReactNode;
  /** Dialogs, toasts and the rest the screens render after the faces area. */
  readonly after?: ReactNode;
}

export function Shell({
  busy = false,
  route = '',
  faces = 0,
  onDropFiles,
  overlay,
  intro,
  children,
  after,
}: ShellProps) {
  const over = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    onDropFiles?.(photoFiles(e));
  };
  return (
    <ThemedApp>
      <main
        className="facemorph-page next-product"
        data-next-busy={String(busy)}
        onDragOver={over}
        onDrop={drop}
      >
        <PreviewStrip route={route} />
        {overlay}
        <Header />
        <p className="next-tagline">
          Morph between any faces. Use each face’s controls to enter words, pick a name or choose a
          photo.
        </p>
        {intro}
        <div className="next-faces-area" data-next-faces={faces}>
          {children}
        </div>
        {after}
        <Footer route={route} />
      </main>
    </ThemedApp>
  );
}
