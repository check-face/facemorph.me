// Recovery in saved files, as the app writes and reads it (fm-fy2.7): the package's schema core (fm-fzzd,
// stylegan-js media/*) bound to the app's face and project values. Stills are written as schema 3
// (generator record and W+ shape from the model descriptor) and read as schema 3, schema 2 PNG/WebP or the
// candidate's schema 1 PNG; a saved MP4 carries a schema-2 project (exact float32 controls, the movie's size,
// frame count and encoder route) and the candidate's schema-1 project stays readable. No DOM: callers pass
// bytes. Nothing here fetches anything, including URLs found in metadata.
// The still half lives in recovery-stills.ts (fm-s0vi) and is re-exported here unchanged.
import {
  embedMp4Project,
  mp4VideoInfo,
  readMp4Project,
  type VideoFileResult,
} from 'stylegan-js';
import { encode as encodeProject, type Project } from '../project/project-json.ts';
import { RecoveryFileError, descriptorFor, latentFor } from './recovery-stills.ts';

export {
  APP_DESCRIPTORS,
  RecoveryFileError,
  checkFaceModel,
  descriptorFor,
  readStill,
  writeStill,
  type FaceIdentity,
  type RecoveredFace,
  type RecoveryFileErrorCode,
} from './recovery-stills.ts';

/** The project as the bridge holds it (project-json.ts Project; latents as plain arrays or Float32Array). */
export type AppProject = Project;

/** The encoder route of a movie whose writer is not known: the policy's sizes, from the movie itself. */
export function routeOfMovie(mp4: Uint8Array): VideoFileResult {
  const info = mp4VideoInfo(mp4);
  if (!info) throw new Error('Project metadata needs an MP4 file.');
  // WebCodecs writes the 1024 policy size; a 512 movie is the policy's fallback (WebCodecs 512 or FFmpeg 512),
  // and only the writer knows which, so a movie without its writer's report records the WebCodecs fallback.
  return {
    width: info.width,
    height: info.height,
    route: 'webcodecs',
    reason: info.width === 1024 ? 'webcodecs-full-size' : 'webcodecs-fallback-size',
  };
}

/** The MP4 with a schema-2 project box for the bridge's project; `route` is the writer's report. */
export function writeProjectMp4(
  mp4: Uint8Array,
  project: AppProject,
  route: VideoFileResult = routeOfMovie(mp4),
): Uint8Array {
  const descriptor = descriptorFor(project.modelSha256, project.noiseSha256);
  if (!descriptor)
    throw new Error('This project’s model is not one this app ships; its recovery data is not written.');
  const m = project.morph;
  return embedMp4Project(mp4, {
    descriptor,
    bundle: { version: project.bundle.version, manifestSha256: project.bundle.manifestSha256 },
    truncationPsi: project.truncationPsi,
    truncationCutoff: project.truncationCutoff,
    morph: {
      algorithmVersion: m.algorithmVersion,
      kind: m.kind as never,
      closed: m.closed,
      width: m.width,
      pinchCenter: m.pinchCenter,
      framesPerSegment: m.framesPerSegment,
      framesPerSecond: m.framesPerSecond,
      controls: m.controls.map((c) => ({
        visitId: c.visitId,
        latent: latentFor(c.latent, descriptor),
      })),
    },
    route,
  });
}

/** What a saved MP4's project reads as: the app's project JSON text, its schema and the writer's report. */
export interface RecoveredProject {
  readonly schemaVersion: 1 | 2;
  /** project-json.ts text (schema 1), for the bridge's project file entry. */
  readonly text: string;
  readonly video: VideoFileResult | null;
}

/**
 * A saved MP4's project: null when the file is not an MP4 or carries no project; a RecoveryFileError when the
 * project is damaged, copied from another movie or of an unknown schema.
 */
export function readProjectMp4(bytes: Uint8Array): RecoveredProject | null {
  const r = readMp4Project(bytes);
  if (r.kind === 'missing') return null;
  if (r.kind === 'damaged')
    throw new RecoveryFileError(
      'damaged',
      'This saved video’s project is damaged.',
      `${r.reason}: ${r.detail}`,
    );
  if (r.kind === 'incompatible-schema')
    throw new RecoveryFileError(
      'incompatible-schema',
      'Unsupported FaceMorph project metadata.',
      `schema ${JSON.stringify(r.schemaVersion)}`,
    );
  const p = r.project;
  if (p.schemaVersion === 1) return { schemaVersion: 1, text: p.text, video: null };
  if (!p.bundle)
    throw new RecoveryFileError('damaged', 'This saved video’s project is damaged.', 'no bundle');
  const project: Project = {
    schemaVersion: 1,
    bundle: p.bundle,
    modelSha256: p.model.modelSha256,
    noiseSha256: p.model.noiseSha256,
    truncationPsi: p.truncationPsi,
    truncationCutoff: p.truncationCutoff,
    morph: {
      algorithmVersion: p.morph.algorithmVersion,
      kind: p.morph.kind as Project['morph']['kind'],
      closed: p.morph.closed,
      width: p.morph.width,
      pinchCenter: p.morph.pinchCenter,
      framesPerSegment: p.morph.framesPerSegment,
      framesPerSecond: p.morph.framesPerSecond,
      controls: p.morph.controls.map((c) => ({
        visitId: c.visitId,
        latent: { space: 'w-plus', shape: [...c.latent.shape], values: Array.from(c.latent.values) },
      })),
    },
  };
  const text = encodeProject(project);
  if (!text.ok)
    throw new RecoveryFileError(
      'damaged',
      'This saved video’s project is damaged.',
      text.error.messages.join(' '),
    );
  const { route, reason, width, height } = p.video;
  return { schemaVersion: 2, text: text.value, video: { width, height, route, reason } };
}
