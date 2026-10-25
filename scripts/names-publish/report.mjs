// Passive socket observations include the publisher and child cf processes.
import { readFileSync } from 'node:fs';
import { classify, tally } from '../names-snapshot/net-recorder.mjs';
const records = readFileSync(process.argv[2], 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map(JSON.parse);
const totals = tally(records, (c) => classify(c));
console.log('Network observation: ' + JSON.stringify(totals));
if (totals['retired-api'].connections) throw Error('Publication contacted a retired API');
const events = readFileSync(process.argv[3], 'utf8')
  .split('\n')
  .flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event.event ? [event] : [];
    } catch {
      return [];
    }
  });
if (!events.some((e) => ['published', 'unchanged'].includes(e.event)))
  throw Error('No verified publication');
for (const event of events) console.log(JSON.stringify(event));
