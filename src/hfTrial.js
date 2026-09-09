import 'regenerator-runtime/runtime';
// Same-origin Gradio queue bridge. No operator token is shipped to the browser.
export async function generate([first, second]) {
  const response = await fetch('/gradio_api/call/morph', {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({data: [first, second]})
  });
  if (!response.ok) throw new Error('Compute is unavailable. Please wait and retry.');
  const {event_id} = await response.json();
  const stream = await fetch(`/gradio_api/call/morph/${encodeURIComponent(event_id)}`, {credentials: 'same-origin'});
  if (!stream.ok || !stream.body) throw new Error('Could not connect to the compute queue.');
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true}).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const name = event.match(/^event: (.*)$/m)?.[1];
        const data = event.match(/^data: (.*)$/m)?.[1];
        if (name === 'error') throw new Error('Generation failed. Sign in with Hugging Face, then retry; your allowance or the trial capacity may be exhausted.');
        if (name === 'complete') {
          const result = JSON.parse(data)[0];
          if (!result.ok) throw new Error(result.message);
          return;
        }
      }
    }
  } finally { await reader.cancel(); }
  throw new Error('The queue disconnected. Retry to check whether your result was saved.');
}

export async function restore([first, second]) {
  const params = new URLSearchParams({first, second});
  const response = await fetch('/trial/result?' + params, {credentials: 'same-origin'});
  if (!response.ok) throw new Error('Saved results are temporarily unavailable.');
  return (await response.json()).found;
}

export async function demoMode(mode) {
  const response = mode === null
    ? await fetch('/review/status')
    : await fetch('/review/session?mode=' + encodeURIComponent(mode), {method: 'POST'});
  if (!response.ok) throw new Error('The local review controls are unavailable.');
  return (await response.json()).mode;
}
