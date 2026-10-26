// The app's grant state per intent: what the person decided about a download for a face, a photo or a morph.

import type { GrantOwnerId } from 'browser-model-manager';

export type AppGrantState =
  | { readonly status: 'pending'; readonly owner: GrantOwnerId }
  | { readonly status: 'approved'; readonly owner: GrantOwnerId; readonly approvedBytes: number }
  | { readonly status: 'declined'; readonly owner: GrantOwnerId }
  | { readonly status: 'cancelled'; readonly owner: GrantOwnerId };
