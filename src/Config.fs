module Config

open Fable.Core

[<Emit("process.env.FACEMORPH_SELF_HOST === '1'")>]
let isSelfHost : bool = jsNative

[<Emit("(typeof window !== 'undefined' ? window.location.origin : '')")>]
let private selfHostOrigin : string = jsNative

[<Emit("process.env.FACEMORPH_SELF_HOST !== '1' && process.env.FACEMORPH_TRIAL === '1'")>]
let isTrial : bool = jsNative

[<Emit("process.env.FACEMORPH_SELF_HOST !== '1' && process.env.FACEMORPH_REVIEW === '1'")>]
let isReview : bool = jsNative

[<Emit("(typeof window !== 'undefined' && window.location.pathname === '/classic')")>]
let isClassicReviewPath : bool = jsNative

let isClassicReview = isReview && isClassicReviewPath

[<Emit("process.env.FACEMORPH_TRIAL_URL")>]
let trialInvitationUrl : string = jsNative

[<Emit("(typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname))")>]
let isLocalPreview : bool = jsNative

[<Emit("(typeof window !== 'undefined' ? window.location.origin : 'https://cdilga-facemorph-next.hf.space')")>]
let private trialOrigin : string = jsNative

let videoDim = 512
let imgDim = 300
let imgSizesSet = [ 300; 512; 1024 ]
let linkpreviewWidth = 1200
let linkpreviewHeight = 628
let ogImgDim = 512
let ogVideoDim = 512
let maxSupportedImgDim = 1024
let thumbnailDim = 128

let siteName = "facemorph.me"
let canonicalBaseUrl = if isSelfHost then selfHostOrigin elif isTrial then trialOrigin else "https://facemorph.me"
let oEmbedApiEndpoint = canonicalBaseUrl + "/oembed.json"
let contactEmail = "checkfaceml@gmail.com"
let githubRepo = "check-face/facemorph.me"
let apiTransitionDateLabel = "October 25, 2026 (AEST)"

let defaultTextValue = "hello"
let defaultNumericSeed = 389u // 389 is one of the seeds featured in the stylegan2 paper

let apiAddr = if isSelfHost then "" elif isTrial then "/trial" else "https://api.facemorph.me"
let encodeApiAddr = apiAddr + "/api/encodeimage/"

let browseFacesEmbedSrc = "https://names.facemorph.me" // Only the hosted mode embeds this service.
