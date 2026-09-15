namespace CheckFace.Next.Assets

open Fable.Core
open Fable.Core.JsInterop

/// Infrastructure boundary for Elmish effects. No runtime admission or UI policy here.
/// Add to App.fsproj before its first consumer when wiring the candidate app.
module ModelAssets =
    [<CLIMutable>]
    type Asset = { sha256: string; size: float; url: string }

    type AcquisitionOptions =
        abstract signal: Browser.Types.AbortSignal

    type AssetHandle =
        abstract sha256: string
        abstract size: float
        /// Consume the body fully to complete integrity validation; cancel when abandoning it.
        abstract ``open``: unit -> JS.Promise<Browser.Types.Response>

    type Cache =
        abstract acquire: asset: Asset * ?options: AcquisitionOptions -> JS.Promise<AssetHandle>

    type CacheEvent =
        abstract status: string
        abstract sha256: string
        abstract bytes: float option

    [<CLIMutable>]
    type BrowserOptions = { timeoutMs: float; maxConcurrent: int; report: CacheEvent -> unit }

    type StorageStatus =
        abstract persistence: string
        abstract usage: float option
        abstract quota: float option
        abstract eviction: string

    [<CLIMutable>]
    type StorageOptions = { requestPersistence: bool }

    [<Import("createBrowserModelCache", "./model-cache.mjs")>]
    let createBrowserCache (options: BrowserOptions): JS.Promise<Cache> = jsNative

    [<Import("storageStatus", "./model-cache.mjs")>]
    let storageStatus (options: StorageOptions): JS.Promise<StorageStatus> = jsNative
