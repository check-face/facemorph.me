// Candidate Product.fs explainSection and FAQ. Copy changes belong to the domain/provider/diagnostics beads.
import { useEffect } from 'react';
import { issueUrl } from '../links.ts';
import { helpTopics, type Run } from './help.ts';
import { StoredData } from './StoredData.tsx';
import { OUTSIDE_REQUESTS } from '../../src/controller/outside-requests.ts';

/** Opens the Help topic a same-page link names (a refusal's Help link, a selector link, a shared #anchor). */
function openTopic(hash: string): void {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  const target = id ? document.getElementById(id) : null;
  const topic = target?.closest('details.next-help-topic');
  if (topic instanceof HTMLDetailsElement) topic.open = true;
}

function useHelpAnchors(): void {
  useEffect(() => {
    openTopic(location.hash);
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    const hash = () => openTopic(location.hash);
    // A click on a link to the topic already in the address bar fires no hashchange; open it on the click.
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      if (a) openTopic(a.getAttribute('href') ?? '');
    };
    addEventListener('hashchange', hash);
    document.addEventListener('click', click, true);
    return () => {
      removeEventListener('hashchange', hash);
      document.removeEventListener('click', click, true);
    };
  }, []);
}

const run = (r: Run, i: number) =>
  typeof r === 'string' ? (
    r
  ) : (
    <a key={i} href={r.href}>
      {r.text}
    </a>
  );

export function Help() {
  useHelpAnchors();
  return (
    <div className="next-help" data-next-help="true">
      <h3 id="help">{'Help'}</h3>
      {helpTopics().map((topic) => (
        <details className="next-faq next-help-topic" id={topic.id} key={topic.id}>
          <summary>{topic.title}</summary>
          {topic.paragraphs.map((p, i) => (
            <p key={i}>{p.map(run)}</p>
          ))}
        </details>
      ))}
    </div>
  );
}

export function Explain({ route = '', reference = '' }: { route?: string; reference?: string }) {
  return (
    <section className="next-explain box" data-next-explain="true" id="next-explain">
      <h2>{'What is this?'}</h2>
      <p>
        {
          'Generate faces from words, seeds or photos. Add faces to build a longer loop. Share the image or video directly.'
        }
      </p>
      <p>
        {
          'Model files and full-size originals are saved on this device where storage is available. Your first generation takes longer while the models download.'
        }
      </p>
      <h3>{'How does it work?'}</h3>
      <p>
        {'Whatever you type is hashed and used to '}
        <a href={'https://en.wikipedia.org/wiki/Random_seed'}>{'seed'}</a>
        {' a random number generator, which picks a point in the latent space of '}
        <a href={'https://github.com/NVlabs/stylegan2'}>{'StyleGAN2'}</a>
        {
          '. The same text always gives the same face. A morph walks between those points and generates every frame along the way.'
        }
      </p>
      <p>
        {'When you use a photo, '}
        <a href={'https://github.com/omertov/encoder4editing'}>{'encoder4editing'}</a>
        {
          ' encodes it as a latent. It balances accuracy against editability, so the result will not look quite like the photo, but it morphs well.'
        }
      </p>
      <p>{'All of it runs here, on your device. Your photos and words are never uploaded.'}</p>
      <StoredData />
      <Help />
      <h3>{'Questions'}</h3>
      <details className="next-faq">
        <summary>{'Are these real people?'}</summary>
        <p>{'Faces made from words or seeds are not real people. They are randomly generated.'}</p>
        <p>{'A face you make from a photo is an encoding of whoever is in that photo.'}</p>
      </details>
      <details className="next-faq">
        <summary>{'How does what I type affect the face?'}</summary>
        <p>
          {
            'It does not, beyond this: the same text always generates the same face. There is no other correlation.'
          }
        </p>
      </details>
      <details className="next-faq">
        <summary>{'Why does a face have glasses when neither endpoint does?'}</summary>
        <p>
          {
            'Intermediate faces are usually a good mix of the endpoints, but sometimes one picks up glasses, or a frown, or goes old-young-old.'
          }
        </p>
        <p>
          {
            'The model has no concept of human features. It learned to produce images that look like faces from a set of numbers, and it happens that doing so well coincides with having gradients for the features we would expect.'
          }
        </p>
        <p>{'Short version: nobody really knows.'}</p>
      </details>
      <details className="next-faq">
        <summary>{'Why is there a creepy second face?'}</summary>
        <p>
          {
            'The training set has a small number of photos with a second face in them. Enough for the model to learn to generate one occasionally, not enough to learn to make it convincing. For an example, try '
          }
          <code>{'alice'}</code>
          {'.'}
        </p>
      </details>
      <details className="next-faq">
        <summary>{'Why are there more women than men?'}</summary>
        <p>
          {'The model was trained on the '}
          <a href={'https://github.com/NVlabs/ffhq-dataset'}>{'Flickr-Faces-HQ dataset'}</a>
          {", crawled from Flickr, and it inherits that site's biases."}
        </p>
      </details>
      <details className="next-faq">
        <summary>{'How many faces are possible?'}</summary>
        <p>{'Practically limitless.'}</p>
        <p>
          {
            'Though it depends how you count. Morph between two faces and there is usually no single frame where you can say it has become a different face. Does every frame count?'
          }
        </p>
        <p>
          {
            'Technically the text is hashed with SHA-256, which puts an upper limit of 2^256 on the number of endpoints you can reach by typing.'
          }
        </p>
      </details>
      <details className="next-faq">
        <summary>{'Can I morph a photo of a real face?'}</summary>
        <p>
          {
            'Yes. Drop or paste a photo onto a face, tap an empty face, or open a face’s mode menu and choose Encode image. Photos are processed on your device and never uploaded.'
          }
        </p>
      </details>
      <details className="next-faq">
        <summary>{'What is next.facemorph.me?'}</summary>
        <p>
          {
            "It's an experimental preview of the next facemorph.me. Instead of a server making your faces, everything happens here on your device. The "
          }
          <a href={'https://facemorph.me'}>{'classic site'}</a>
          {' still works as it always has while we test this one.'}
        </p>
        <p>
          {"The classic site's server and API are being retired. "}
          <a href={'https://facemorph.me/retirement'}>{"Here's why, and what's changing"}</a>
          {'.'}
        </p>
      </details>
      <details className="next-faq" id="privacy">
        <summary>{'Does anything leave my device?'}</summary>
        <p>
          {
            "Your photos, the words you type and the faces you make are never uploaded. The first visit downloads the face models, about 200 MB, plus about 1 GB more the first time you use a photo. They're saved on this device, so later visits don't download them again."
          }
        </p>
        <p>
          {
            'Completed generated faces are cached on this device when storage is available, and your last faces can be restored when you come back. Reloading in the same tab tries to bring back the words, seeds or photo file names you used as well; that is best effort, so in a new tab, or when the browser keeps nothing, a face comes back as "Restored face". Words and file names are never saved past this tab, and source photos are kept only in the current tab.'
          }
        </p>
        <p>{'This page makes these requests, and no others:'}</p>
        <ul className="next-privacy-requests">
          <li>
            <strong>{'This site'}</strong>
            {
              ": the app itself, the model files (/runtime/) when a face first needs them, and the list of published names and preview pictures (/catalogue.json) when a face's preview or Browse names needs it."
            }
          </li>
          <li>
            <strong>{'This site, /stats/v1'}</strong>
            {
              ': anonymous usage statistics (see "What are usage statistics?"), unless you switch them off.'
            }
          </li>
          <li>
            <strong>{'This site, /diagnostics/events'}</strong>
            {
              ': debug reports (see "What\'s in a debug report?"), only after you turn on debug reporting or choose Send this report.'
            }
          </li>
          {OUTSIDE_REQUESTS.filter((r) => !r.purpose.startsWith('Diagnostics collector')).map(
            (r) => (
              <li key={r.host}>
                <strong>{r.host}</strong>
                {`: ${r.purpose} ${r.trigger}`}
              </li>
            ),
          )}
        </ul>
        <p>
          {
            'Typing a word or seed sends nothing. Google Analytics (see "What do you count?") and debug reports are separate: turning debug reports off does not change analytics, which follows your browser’s Do Not Track, Global Privacy Control and Save-Data settings.'
          }
        </p>
        <p>
          {
            'Saved PNG, WebP and MP4 files carry metadata: the exact latent of each face (the numbers that make it) and the model and provenance details, so FaceMorph can open them again. They never contain your photos, the words you typed or file names.'
          }
        </p>
        <p>
          <a href="#debug-reporting">{'Debug reports: turn them on or off'}</a>
        </p>
      </details>
      <details className="next-faq">
        <summary>{'What do you count?'}</summary>
        <p>
          {
            'So we can see whether this works for people, we use Google Analytics to count visits, which features get used (names, seeds, photos, morph shapes, saving and sharing), how each job ends and how long it took, which processing mode ran, and a rough device class such as phone or laptop, its operating system and how much memory it reports. When a job fails, we record the kind of failure and the step it failed at.'
          }
        </p>
        <p>
          {
            'We never send your photos, the words or seeds you type, your faces or videos, file names, or error messages. Advertising features and Google signals are off. Nothing is counted if your browser sends Do Not Track, Global Privacy Control or Save-Data, or if you block Google Analytics. It is separate from debug reports, which stay off until you turn them on.'
          }
        </p>
      </details>
      <details className="next-faq" id="usage-statistics">
        <summary>{'What are usage statistics?'}</summary>
        <p>
          {
            'A few anonymous counts so we can compare this version with the old site: visits by device class (iPhone, Android or desktop) and whether it is a first or returning visit; jobs by kind (face, photo, morph, names, blend), processing mode and how they ended, with how long they took; the time to the first result; model compute time per face; how long the models took to download or load; morph frames; saved or shared files by kind and method; and the model megabytes a first visit downloads.'
          }
        </p>
        <p>
          {
            'They are sent in small batches to /stats/v1 on this site, where only running totals are kept. No cookie or identifier is used, and no words, seeds, names, photos, faces or file names are ever sent. Nothing is counted if your browser sends Global Privacy Control or Do Not Track, asks to save data, or is automated. To turn it off, use the Usage statistics switch next to the debug-report control at the bottom of this page.'
          }
        </p>
      </details>
      <details className="next-faq">
        <summary>{'Why is the first face slow? Will it work on my phone?'}</summary>
        <p>
          {
            "The first face waits for the models to download and for a quick check that this device gets the maths right. After that a face takes under a second on a computer with a good graphics card, and longer on phones and on computers where the browser can't use the graphics card."
          }
        </p>
        <p>
          {
            'Slower devices still finish; the page tells you how long it expects. For long morphs, a laptop or desktop with a graphics card is much quicker.'
          }
        </p>
      </details>
      <details className="next-faq">
        <summary>{"What's in a debug report?"}</summary>
        <p>
          {
            'A random ID for the report, the site version, your browser and operating system, rough device facts like the number of processor cores, which processing mode was used, how long each step took, and error codes. Never your photos, words, faces or videos. Reports are kept with no deletion date.'
          }
        </p>
        <p>
          {
            'After an error you can send just that one report with Send this report; reporting stays off. Turning reporting off stops sending at once and discards anything not yet sent.'
          }
        </p>
        <p>
          <a href="#debug-reporting">{'Debug reports: turn them on or off'}</a>
        </p>
      </details>
      <details className="next-faq">
        <summary>{'Something went wrong. How do I tell you?'}</summary>
        <p>
          <a href={issueUrl({ route, reference })} target="_blank" rel="noopener">
            {'Open an issue on GitHub'}
          </a>
          {' (the version and device are filled in for you), or email '}
          <a href={'mailto:checkfaceml@gmail.com'}>{'checkfaceml@gmail.com'}</a>
          {'. If you sent a debug report, include its reference.'}
        </p>
      </details>
      <details className="next-faq">
        <summary>{'Is there an API I can self-host?'}</summary>
        <p>
          {'Yes. The server source is at '}
          <a href={'https://github.com/facemorph-me/checkface'}>
            {'github.com/facemorph-me/checkface'}
          </a>
          {' with setup instructions in its README'}
          {'.'}
        </p>
        <p>
          {
            'If you need a setup under your own control, self-hosting is the safest option. Bugs belong in a GitHub issue; for questions about the transition, email '
          }
          <a href={'mailto:checkfaceml@gmail.com'}>{'checkfaceml@gmail.com'}</a>
          {'.'}
        </p>
      </details>
    </section>
  );
}
