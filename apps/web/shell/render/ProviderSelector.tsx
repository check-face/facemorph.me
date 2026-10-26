// The processing selector above the first + (fm-5kpx, face.selector-names). It was under More options → Advanced;
// it is now one compact control above the faces. It writes only the requested choice; route admission decides what
// actually runs and the status line says which route ran. Choosing a route requests nothing and authorizes no
// download (fm-qrfz). The optional links open the Help topics below the page.
import { PROVIDERS, type Provider } from './MorphSlot.tsx';

export interface ProviderSelectorProps {
  readonly provider: Provider;
  readonly busy: boolean;
  readonly onProvider: (provider: Provider) => void;
}

export function ProviderSelector({ provider, busy, onProvider }: ProviderSelectorProps) {
  return (
    <div className="next-provider-row" role="group" aria-label="Processing">
      <label className="next-provider-field">
        <span>Processing</span>
        <select
          value={provider}
          disabled={busy}
          aria-label="Processing mode"
          onChange={(e) => onProvider(e.target.value as Provider)}
        >
          {PROVIDERS.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <p className="next-provider-note">
        Leave processing on automatic unless you are comparing routes. Forced routes still need to
        pass this device’s checks. <a href="#computer-requirements">Using a computer</a> ·{' '}
        <a href="#supported-browsers">Supported browsers</a>
      </p>
    </div>
  );
}
