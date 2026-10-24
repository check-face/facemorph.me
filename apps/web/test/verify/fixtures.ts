// The verification fixtures (fm-48bj), each named once with its digest: synthetic photos (no person's photo, no
// weights), recovery-bearing stills and a saved project MP4 written by the candidate's own writers
// (apps/web/test/fixtures/verify/make-stills.mjs), and the defect-1 regression page. A journey names a fixture by
// id; fixtureFindings fails a run whose fixture bytes are not the recorded ones. The defect-1 page is source the
// tests read, so it carries no digest.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fixture {
  readonly path: string;
  readonly sha256: string | null;
  readonly what: string;
}

export const FIXTURES = {
  'photo-one-face': {
    path: 'apps/web/src/public/preview/hello-1024.webp',
    sha256: '0fd3aacaf63a9b574960f926e4fbd48fadf853ba16189519053438e55fb9d615',
    what: 'a metadata-free generated face (no EXIF or XMP chunk; not a photo of a person)',
  },
  'photo-several-faces': {
    path: 'tests/crop/fixtures/multi-face.jpg',
    sha256: '945bdeb3fb9c9718bbe122caf2ac71dc38163fb5c641a99c9be11bc6703c2a41',
    what: 'several faces (fm-bbhu crop fixtures, synthetic)',
  },
  'photo-no-face': {
    path: 'tests/crop/fixtures/no-face.jpg',
    sha256: '13a45e881d5215ee1059ea6e6bd93d6420f8ae57ddf497dacf29d7a716985d9c',
    what: 'no detectable face (drawn shapes)',
  },
  'photo-rotated-exif': {
    path: 'tests/crop/fixtures/oriented.jpg',
    sha256: '838d4bcfaa21a0243fe0573354dfd4a0bbf41612ebaf9601f9462427f7bc2452',
    what: 'a face with an EXIF orientation tag',
  },
  'still-recovery-v1': {
    path: 'apps/web/test/fixtures/verify/stills/recovery-v1.png',
    sha256: '450598ddc48c4aa4969647d419925000c02dd4c7868e8787107793171303491c',
    what: 'schema 1 PNG (decorateImage), seed 42',
  },
  'still-recovery-v2': {
    path: 'apps/web/test/fixtures/verify/stills/recovery-v2.png',
    sha256: '5f508cf4f0972714b4ac5fc90e06d00469dada6d35fd571aa5c95d819f706006',
    what: 'schema 2 PNG (embedRecovery), seed 42',
  },
  'still-recovery-v2-webp': {
    path: 'apps/web/test/fixtures/verify/stills/recovery-v2.webp',
    sha256: '8e936835367560c7526f574fec87d512d067254ec640e9f8ed57c1c91863f424',
    what: 'schema 2 lossless WebP (embedRecovery), seed 42',
  },
  'still-model-mismatch-v2': {
    path: 'apps/web/test/fixtures/verify/stills/model-mismatch-v2.png',
    sha256: '1b5a22f0d7d2245b2603f8a732eac76336d93001e1a2c3900455cece7a75d8ec',
    what: 'schema 2 PNG for a model this bundle is not (modelSha256 9...9)',
  },
  'still-damaged-v1': {
    path: 'apps/web/test/fixtures/verify/stills/damaged-v1.png',
    sha256: '8cf9bf60b4f64c6c4d4795b4a9854e1ffbd3b44cd7b51c80cee2aed6c250280f',
    what: 'schema 1 PNG with one metadata byte flipped (CRC mismatch)',
  },
  'project-mp4': {
    path: 'apps/web/test/fixtures/verify/stills/project.mp4',
    sha256: '916a2b6e1384bd7066688ceb2f9546e6e11c03d1205751059e862d79e4888cdd',
    what: 'saved project MP4 (decorateVideo over the fixture morph, project-v1.fixture.json)',
  },
  'defect-1-page': {
    path: 'apps/web/test/fixtures/verify/operated.html',
    sha256: null,
    what: 'the defect-1 regression page: a covered, a clipped and an off-screen control',
  },
} as const satisfies Record<string, Fixture>;

export type FixtureId = keyof typeof FIXTURES;

export const REPO = new URL('../../../../', import.meta.url).pathname;

/** A fixture's absolute path. */
export const fixturePath = (id: FixtureId) => join(REPO, FIXTURES[id].path);

/** Missing fixtures and fixtures whose bytes are not their recorded digest. */
export function fixtureFindings(
  ids: readonly FixtureId[] = Object.keys(FIXTURES) as FixtureId[],
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const f: Fixture = FIXTURES[id];
    const path = join(REPO, f.path);
    if (!existsSync(path)) out.push(`${id}: ${f.path} is missing`);
    else if (f.sha256 && createHash('sha256').update(readFileSync(path)).digest('hex') !== f.sha256)
      out.push(`${id}: ${f.path} is not its recorded digest`);
  }
  return out;
}
