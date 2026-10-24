// The project-json cases (fm-7s3a): every classic verify-fable.mjs assertion as a named case (its checks
// counted as classic counted them: a round trip is decode, encode and equality), then goldens, numeric
// formatting, escapes, types and limits. Inputs are plain text; `file` cases read a committed file.
import { readFileSync } from 'node:fs';

const FIXTURE = 'src/Next/project-v1.fixture.json';
const CONTROL_MP4 = 'test/fixtures/project/control-morph-mp4.project.json';
const at = (path) => new URL(`../../${path}`, import.meta.url);
const fixture = () => JSON.parse(readFileSync(at(FIXTURE), 'utf8'));

export const KINDS = [
  'linear',
  'pairwise-ellipse',
  'pairwise-figure8',
  'full-smooth-ellipse',
  'full-smooth-figure8',
];

export function cases() {
  const f = fixture();
  const s = (value) => JSON.stringify(value);
  const withControls = (fn) => ({
    ...f,
    morph: { ...f.morph, controls: f.morph.controls.map(fn) },
  });
  const out = [];
  const add = (name, input, extra = {}) => out.push({ name, input, ...extra });
  // verify-fable.mjs, in its order.
  for (const kind of KINDS)
    add(`verify-fable: ${kind} round-trips`, s({ ...f, morph: { ...f.morph, kind } }), {
      classicChecks: 3,
    });
  add(
    'verify-fable: escaped string and psi round-trip',
    s({
      ...f,
      bundle: { ...f.bundle, version: 'quote" slash\\ newline\n emoji 🙂' },
      truncationPsi: 0.12345678901234566 /* classic wrote 0.12345678901234567: the same double */,
    }),
    { classicChecks: 3 },
  );
  const malformed = [
    ['unterminated object', '{'],
    ['null', 'null'],
    ['array', '[]'],
    ['duplicate field', '{"schemaVersion":1,"schemaVersion":1}'],
    ['schema version 2', s({ ...f, schemaVersion: 2 })],
    ['unknown root field', s({ ...f, future: true })],
    ['unknown morph kind', s({ ...f, morph: { ...f.morph, kind: 'unrecognized' } })],
    ['closed as a string', s({ ...f, morph: { ...f.morph, closed: 'true' } })],
    ['infinite width', s(f).replace('"width":0.2', '"width":1e999')],
    ['leading-zero schema version', s(f).replace('"schemaVersion":1', '"schemaVersion":01')],
    ['trailing content', s(f) + 'null'],
    ['nesting 18 deep', '['.repeat(18) + '0' + ']'.repeat(18)],
  ];
  for (const [name, input] of malformed)
    add(`verify-fable: rejects ${name}`, input, { classicChecks: 1 });
  for (const space of ['z', 'w', 'w-plus'])
    add(
      `verify-fable: space ${space} round-trips`,
      s(withControls((c) => ({ ...c, latent: { ...c.latent, space } }))),
      { classicChecks: 3 },
    );
  for (const space of [undefined, 'q', 'd', 'unknown'])
    add(
      `verify-fable: space ${space ?? 'missing'} is rejected`,
      s(withControls((c) => ({ ...c, latent: { ...c.latent, space } }))),
      { classicChecks: 1 },
    );
  add(
    'verify-fable: mixed spaces are rejected',
    s(withControls((c, i) => ({ ...c, latent: { ...c.latent, space: i === 0 ? 'z' : 'w-plus' } }))),
    { classicChecks: 1 },
  );

  // Goldens.
  add('golden: project-v1.fixture.json', readFileSync(at(FIXTURE), 'utf8'), {
    file: FIXTURE,
    golden: 'fixture',
  });
  add(
    'golden: project JSON embedded in a control-exported morph MP4',
    readFileSync(at(CONTROL_MP4), 'utf8'),
    {
      file: CONTROL_MP4,
      golden: 'control-mp4',
      provenance:
        "the 'FaceMorphProject' uuid box payload (372,372 bytes at offset 1039320) of facemorph.mp4 (sha256 " +
        '8b6b1ccce9680dbb7fa2dd38eebb6a5fa3134f0b1bf05d30ce42912099c12e7e), the morph MP4 that the pinned control ' +
        "551b6072 saved in classic's next-e2e-browser.py journey on eris (real-ui-cpu, lease 20261024T164732Z-a26a714c)",
    },
  );

  // Versions, fields, types.
  for (const v of [0, '1', 1.5, -1, null])
    add(`schema version ${JSON.stringify(v)} is rejected`, s({ ...f, schemaVersion: v }));
  const { noiseSha256: _, ...missing } = f;
  add('a missing root field is rejected', s(missing));
  add(
    'a missing morph field is rejected',
    s({ ...f, morph: { ...f.morph, pinchCenter: undefined } }),
  );
  add('truncationCutoff 1.5 is rejected', s({ ...f, truncationCutoff: 1.5 }));
  add('truncationCutoff above Int32 is rejected', s({ ...f, truncationCutoff: 2147483648 }));
  add('truncationCutoff at Int32 max is admitted', s({ ...f, truncationCutoff: 2147483647 }));
  add(
    'a negative shape is rejected',
    s(withControls((c) => ({ ...c, latent: { ...c.latent, shape: [-2] } }))),
  );
  add(
    'a string latent value is rejected',
    s(withControls((c) => ({ ...c, latent: { ...c.latent, values: ['0', '1'] } }))),
  );
  add('a numeric visit ID is rejected', s(withControls((c, i) => ({ ...c, visitId: i }))));
  add(
    'a blank visit ID is invalid',
    s(withControls((c, i) => ({ ...c, visitId: i === 0 ? ' ' : c.visitId }))),
  );
  add('duplicate visit IDs are invalid', s(withControls((c) => ({ ...c, visitId: 'A' }))));
  add(
    'an uppercase manifest digest is invalid',
    s({ ...f, bundle: { ...f.bundle, manifestSha256: 'A'.repeat(64) } }),
  );
  add('a negative psi is invalid', s({ ...f, truncationPsi: -0.5 }));
  add('an odd frame count is invalid', s({ ...f, morph: { ...f.morph, framesPerSegment: 3 } }));
  add('frame rate 241 is invalid', s({ ...f, morph: { ...f.morph, framesPerSecond: 241 } }));
  add('an open full-smooth path is invalid', s({ ...f, morph: { ...f.morph, closed: false } }));
  add(
    'an open linear path is admitted',
    s({ ...f, morph: { ...f.morph, closed: false, kind: 'linear' } }),
  );
  add(
    'adjacent identical faces are invalid',
    s(withControls((c) => ({ ...c, latent: { ...c.latent, values: [5, 5] } }))),
  );
  add(
    'mismatched shapes are invalid',
    s(withControls((c, i) => ({ ...c, latent: { ...c.latent, shape: i ? [2] : [1, 2] } }))),
  );
  add(
    'several errors are all named, in order',
    s({ ...f, truncationPsi: -1, morph: { ...f.morph, framesPerSegment: 3, framesPerSecond: 0 } }),
  );

  // Numeric formatting: what classic's shipped build wrote (String(value)).
  for (const n of [
    '0',
    '-0',
    '1e-7',
    '4294967295',
    '1e21',
    '0.30000000000000004',
    '5e-324',
    '1.7976931348623157e308',
    '2.5E+3',
    '100',
  ])
    add(`numeric formatting: psi ${n}`, s(f).replace('"truncationPsi":1', `"truncationPsi":${n}`));
  add(
    'numeric formatting: width and latent -0, 1e-7',
    s(f).replace('"width":0.2', '"width":1e-7').replace('"values":[0,0]', '"values":[-0,1e-7]'),
  );

  // Strings and escapes.
  add(
    'escapes: \\/ and \\u00e9 and an unpaired surrogate',
    s(f).replace('"fixture-v1"', '"fixture\\/v1 \\u00e9 \\ud800"'),
  );
  add(
    'escapes: control characters are written as \\u',
    s({ ...f, bundle: { ...f.bundle, version: 'a\u0001b\tc\u001f' } }),
  );
  add(
    'escapes: an unescaped control character is rejected',
    s(f).replace('"fixture-v1"', '"fixture\u0001v1"'),
  );
  add('escapes: an invalid escape is rejected', s(f).replace('"fixture-v1"', '"fixture\\qv1"'));
  add('escapes: a truncated unicode escape is rejected', '{"a":"\\u12');
  add('whitespace: tabs, CR and LF between tokens are accepted', s(f).replaceAll(',', ',\r\n\t '));
  add('whitespace: a leading byte-order mark is rejected', '﻿' + s(f));

  // Limits.
  add(
    'limits: a 4096-character version is admitted',
    s({ ...f, bundle: { ...f.bundle, version: 'v'.repeat(4096) } }),
  );
  add(
    'limits: a 4097-character version is rejected',
    s({ ...f, bundle: { ...f.bundle, version: 'v'.repeat(4097) } }),
  );
  const many = (n) =>
    Array.from({ length: n }, (_, i) => ({
      visitId: `V${i}`,
      latent: { space: 'w-plus', shape: [2], values: [i, 0] },
    }));
  add('limits: 64 controls are admitted', s({ ...f, morph: { ...f.morph, controls: many(64) } }));
  add('limits: 65 controls are rejected', s({ ...f, morph: { ...f.morph, controls: many(65) } }));
  add(
    'limits: 33 fields in an object are rejected',
    s({
      ...f,
      morph: {
        ...f.morph,
        ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`x${i}`, 0])),
      },
    }),
  );
  add(
    'limits: a 129-character number is rejected',
    s(f).replace('"truncationPsi":1', `"truncationPsi":1.${'0'.repeat(127)}`),
  );
  add(
    'limits: framesPerSegment 100002 is invalid',
    s({ ...f, morph: { ...f.morph, framesPerSegment: 100002 } }),
  );
  add(
    'limits: a 9-dimensional shape is invalid',
    s(
      withControls((c, i) => ({
        ...c,
        latent: { ...c.latent, shape: [1, 1, 1, 1, 1, 1, 1, 1, 2], values: [i, 0] },
      })),
    ),
  );
  return out;
}
