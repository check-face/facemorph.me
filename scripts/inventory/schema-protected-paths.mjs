#!/usr/bin/env node
// fm-p7v schema for inventory/protected-paths.json.
// The wind-down stage precondition check (fm-y9m) and the CI inventory job both validate the
// committed file through this module, so the schema lives here and nowhere else.
// Every violation is a plain {path, rule, detail} record; an empty array means the document is
// well-formed. Values only - no I/O here, so tests call it with plain objects.

const DISPOSITIONS = new Set(['keep', 'historical']);
const OWNER = /^ws-[a-z0-9-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const bad = (path, rule, detail) => ({ path: path ?? null, rule, detail });

function validatePathEntry(entry, seen) {
  const out = [];
  const path = entry?.path;
  if (typeof path !== 'string' || path.length === 0)
    return [bad(null, 'path-missing', 'every entry needs a non-empty path')];
  if (seen.has(path)) out.push(bad(path, 'duplicate-path', 'listed twice'));
  seen.add(path);

  const readers = entry?.readers;
  if (!Array.isArray(readers) || readers.length === 0) {
    out.push(
      bad(
        path,
        'reader-missing',
        'every entry needs at least one reader (use reader "none attested" with the search evidence when nothing reads it)',
      ),
    );
  } else {
    readers.forEach((r, i) => {
      if (typeof r?.reader !== 'string' || r.reader.length === 0)
        out.push(bad(path, 'reader-missing', `readers[${i}].reader is empty`));
      if (typeof r?.evidence !== 'string' || r.evidence.length === 0)
        out.push(
          bad(
            path,
            'evidence-missing',
            `readers[${i}].evidence is empty (cite file:line or the search that found nothing)`,
          ),
        );
    });
  }

  if (typeof entry?.owner !== 'string' || !OWNER.test(entry.owner))
    out.push(bad(path, 'owner-missing', 'every entry needs an owner workstream label (ws-...)'));
  if (!DISPOSITIONS.has(entry?.disposition))
    out.push(
      bad(path, 'bad-disposition', `disposition must be one of ${[...DISPOSITIONS].join(', ')}`),
    );
  if (entry?.note !== undefined && typeof entry.note !== 'string')
    out.push(bad(path, 'bad-note', 'note must be a string when present'));
  return out;
}

function validateExternalSource(entry, index) {
  const out = [];
  const label = entry?.url ?? `external_sources[${index}]`;
  if (typeof entry?.url !== 'string' || entry.url.length === 0)
    out.push(
      bad(
        label,
        'url-missing',
        'external source needs a url (or an explicit local-only description)',
      ),
    );
  if (
    !Array.isArray(entry?.consumers) ||
    entry.consumers.length === 0 ||
    entry.consumers.some((c) => typeof c !== 'string' || c.length === 0)
  ) {
    out.push(bad(label, 'consumer-missing', 'external source needs at least one consumer'));
  }
  if (typeof entry?.terms !== 'string' || entry.terms.length === 0)
    out.push(bad(label, 'terms-missing', 'external source needs its terms/licence statement'));
  if (
    entry?.sha256 !== undefined &&
    entry.sha256 !== null &&
    !(typeof entry.sha256 === 'string' && SHA256.test(entry.sha256))
  ) {
    out.push(
      bad(
        label,
        'bad-sha256',
        'sha256 must be 64 lowercase hex characters or null (with the unpinned reason in provenance)',
      ),
    );
  }
  if (
    entry?.size_bytes !== undefined &&
    !(Number.isInteger(entry.size_bytes) && entry.size_bytes > 0)
  ) {
    out.push(bad(label, 'bad-size', 'size_bytes must be a positive integer when present'));
  }
  if (typeof entry?.provenance !== 'string' || entry.provenance.length === 0)
    out.push(
      bad(
        label,
        'provenance-missing',
        'external source needs its provenance/history-transfer note',
      ),
    );
  return out;
}

export function validateProtectedPaths(doc) {
  const out = [];
  if (!Array.isArray(doc?.paths))
    return [bad(null, 'paths-missing', 'document needs a paths array')];
  const seen = new Set();
  for (const entry of doc.paths) out.push(...validatePathEntry(entry, seen));
  if (doc?.external_sources !== undefined) {
    if (!Array.isArray(doc.external_sources))
      out.push(
        bad(null, 'external-sources-type', 'external_sources must be an array when present'),
      );
    else doc.external_sources.forEach((s, i) => out.push(...validateExternalSource(s, i)));
  }
  return out;
}
