// Help below the page (provider.copy, fm-gbdt): browser and computer guidance, CPU/WebGPU and separate
// photo/video support, first-use costs, recovery for every refusal reason, and the limits a person should know
// before they meet them. Data only; Explain.tsx renders it. Every anchor a refusal names (route-admission.ts)
// and the optional selector links (#computer-requirements, #supported-browsers) open one of these topics.
// No installer or native download is recommended anywhere: the desktop packages are retired.

/** A paragraph is text runs and links. */
export type Run = string | { readonly text: string; readonly href: string };
export interface HelpTopic {
  /** The element id; a link to `#${id}` opens this topic. */
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly (readonly Run[])[];
}

/** Licence and notices page, staged with the runtime by hosting/next-static/stage.py. */
export const NOTICES_HREF = '/runtime/notices/index.html';
/** The saved-file format reference (packages/stylegan-js/docs/formats.md, fm-fy2.7): formats, limits, damage. */
export const FORMATS_HREF =
  'https://github.com/facemorph-me/facemorph.me/blob/main/packages/stylegan-js/docs/formats.md';

/** This site's own entry URL (the current origin), never a retired desktop package. */
export const siteEntry = (): string =>
  `${(globalThis as { location?: { origin?: string } }).location?.origin ?? 'https://next.facemorph.me'}/`;

/**
 * Tested browser/OS rows. This bead templates the list; verify.join (fm-fy2.11) generates the rows and their
 * evidence status from the release summary JSON. Until then every row says it has no release evidence.
 */
export interface SupportRow {
  readonly browser: string;
  readonly system: string;
  readonly status: string;
}
export const SUPPORT_ROWS: readonly SupportRow[] = [
  {
    browser: 'Chrome or Edge',
    system: 'Windows, macOS, Linux',
    status: 'not yet verified for this release',
  },
  {
    browser: 'Firefox',
    system: 'Windows, macOS, Linux',
    status: 'not yet verified for this release',
  },
  { browser: 'Chrome', system: 'Android', status: 'not yet verified for this release' },
  { browser: 'Safari', system: 'macOS, iOS', status: 'not yet verified for this release' },
];

export function helpTopics(entry: string = siteEntry()): readonly HelpTopic[] {
  return [
    {
      id: 'computer-requirements',
      title: 'Using a computer',
      paragraphs: [
        [
          'A laptop or desktop is much quicker for long morphs and for photos. Open ',
          { text: entry, href: entry },
          ' in a current browser on the computer; there is nothing to install.',
        ],
        [
          'There is no way to hand a phone session over to a computer. Save the faces you want as PNG or WebP, move the files across (email, a cloud drive, a cable or nearby sharing), then open each file as a face on the computer.',
        ],
      ],
    },
    {
      id: 'supported-browsers',
      title: 'Supported browsers',
      paragraphs: [
        [
          'Faces need a current browser with WebAssembly; a graphics card is used through WebGPU where the browser offers it. Photos and video are checked separately, so a browser can make faces but not encode photos or video.',
        ],
        [
          `Tested list: ${SUPPORT_ROWS.map((r) => `${r.browser} on ${r.system} (${r.status})`).join('; ')}.`,
        ],
      ],
    },
    {
      id: 'help-webgpu-route',
      title: 'Graphics (WebGPU) processing',
      paragraphs: [
        [
          'With Processing mode on Automatic, faces use the graphics card when this browser offers WebGPU, the adapter can hold the model and its check face comes out right; otherwise they use the CPU.',
        ],
        [
          'If you forced the graphics route and it was refused, set Processing mode (More options, Advanced) back to Automatic or CPU. If the graphics device stopped responding, reloading the page starts it again; your saved files are unaffected.',
        ],
      ],
    },
    {
      id: 'help-cpu-route',
      title: 'CPU processing and recovery',
      paragraphs: [
        [
          'The CPU route works in any current Chrome, Edge, Firefox or Safari. It is slower than a graphics card, especially on phones, but it finishes; the page says how long it expects.',
        ],
        [
          'If this browser cannot run the CPU route, or its check face came out wrong, try another current browser or a computer. A morph needs faces, so it is refused wherever faces are.',
        ],
      ],
    },
    {
      id: 'help-photo-encoding',
      title: 'Photos',
      paragraphs: [
        [
          'Turning a photo into a face needs the photo encoder, a much larger download the first time, and a large block of memory. Some phones cannot reserve it; closing other tabs can help, and a computer always has more room. Words and seeds still make faces where photos cannot.',
        ],
        [
          'Photos you are still working on stay in this tab only. Switching to another app can pause work, and reloading the page loses unfinished photo retries, so finish or save a face before you leave.',
        ],
      ],
    },
    {
      id: 'help-video-export',
      title: 'Video export',
      paragraphs: [
        [
          'A morph is saved as MP4. Where this browser cannot encode 1024 px video it saves at 512 px instead, keeping the whole sequence and framing. Where it has no video encoder at all, a pinned FFmpeg codec served from this site encodes at 512 px.',
        ],
        [
          'Reopening a morph project from its MP4 is not available yet; the MP4 is a video. To change a morph later, keep its faces as PNG or WebP.',
        ],
      ],
    },
    {
      id: 'help-first-use',
      title: 'First use',
      paragraphs: [
        [
          'The first face downloads the face model and checks that this device gets the maths right. The first photo downloads the photo encoder, which is several times larger. The download notice shows each size before anything downloads, and both are kept for later visits where the browser allows.',
        ],
      ],
    },
    {
      id: 'help-cache',
      title: 'What this device keeps',
      paragraphs: [
        [
          'Downloaded models and finished faces are kept in browser storage as a convenience, not a promise: the browser may clear them when space runs low, in private windows or when you clear site data. Then they download or generate again.',
        ],
        [
          'Your last faces come back when you return. A reload in the same tab also tries to bring back the words, seeds or photo file names you used; that is best effort, and a face that comes back without them shows "Restored face". Words and file names are kept only in this tab, never in saved files.',
        ],
        [
          'The line just above Help shows how much is saved for your faces. Clear removes the saved faces, the last session and the words kept in this tab, and keeps the downloaded models and your slider setting.',
        ],
      ],
    },
    {
      id: 'help-keep-originals',
      title: 'Keep your originals',
      paragraphs: [
        [
          'A saved PNG or WebP carries the face data it was made from. Drop it on a face, or choose it as a face’s photo, and the face comes back exactly, without encoding the photo again or downloading the photo encoder. Keep the original file to reopen or edit a still later.',
        ],
        [
          'Social and messaging apps often recompress shared images and strip that data, so a shared copy may open only as a new photo. Your own downloaded file stays the copy to recover from.',
        ],
        [
          'What each format carries and leaves out, its size limits, and how a damaged or stripped file behaves: ',
          { text: 'saved file formats', href: FORMATS_HREF },
          '.',
        ],
      ],
    },
    {
      id: 'help-old-links',
      title: 'Old links, apps and the API',
      paragraphs: [
        [
          'Links with an old face ID (GUID) from the classic site no longer open a face, and old results did not carry over. The desktop apps are retired and not offered for download. The classic API server is retired too.',
        ],
        [
          'Its source stays at ',
          {
            text: 'github.com/facemorph-me/checkface',
            href: 'https://github.com/facemorph-me/checkface',
          },
          '. Its README describes the classic Docker self-host setup for specialists who want to run it themselves.',
        ],
      ],
    },
    {
      id: 'help-device-check',
      title: 'What the device check means',
      paragraphs: [
        [
          'The check before the first face proves the maths is right on this device. It does not guarantee the model fits in memory for every operation, nor that work keeps going while the page is in the background or the screen is off.',
        ],
      ],
    },
    {
      id: 'help-recovery',
      title: 'When something goes wrong',
      paragraphs: [
        [
          'Try again first: completed faces are kept. If it fails again, set Processing mode to CPU, reload the page, or try another browser or a computer. Then report it so we can fix it.',
        ],
      ],
    },
    {
      id: 'help-licences',
      title: 'Licences and notices',
      paragraphs: [
        [
          'The face model, photo encoder, runtime and video codec each come with their own terms. ',
          { text: 'Read the licences and notices', href: NOTICES_HREF },
          '.',
        ],
      ],
    },
  ];
}
