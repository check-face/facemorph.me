#load "Contracts.fs"
#load "Runtime.fs"
#load "ProjectJson.fs"
open CheckFace.Next.Contracts
open CheckFace.Next.Runtime

let mutable checks = 0
let check name condition =
    if not condition then failwith name
    checks <- checks + 1
let hash = String.replicate 64 "a"
let bundle = { Version = "fixture-v1"; ManifestSha256 = hash }
let control id x = { VisitId = id; Latent = { Space = WPlus; Shape = [2]; Values = [x; 0.] } }
let morph = { AlgorithmVersion = "geometry-fixture-v1"; Kind = FullSmoothFigure8; Controls = [control "A" 0.; control "B" 1.; control "C" 2.]; Closed = true; Width = 0.2; PinchCenter = true; FramesPerSegment = 4; FramesPerSecond = 24 }
let project = { SchemaVersion = 1; Bundle = bundle; ModelSha256 = hash; NoiseSha256 = hash; TruncationPsi = 1.; TruncationCutoff = 0; Morph = morph }
let schedule p = match samples p with Ok values -> Seq.toList values | Error e -> failwithf "%A" e
check "valid closed project" (validate project = [])
let frames = schedule project
check "closed frame count" (frames.Length = 12)
check "each face exactly once; no duplicate terminal A" ((frames |> List.choose (fun s -> s.ControlVisit)) = ["A"; "B"; "C"])
check "every segment midpoint sampled" ((frames |> List.filter (fun s -> s.IsMidpoint) |> List.length) = 3)
let openFrames = schedule { project with Morph = { morph with Kind = Linear; Closed = false } }
check "open final endpoint once" (openFrames.Length = 9 && (List.last openFrames).U = 1. && (List.last openFrames).ControlVisit = Some "C")
check "odd schedule rejected" (validate { project with Morph = { morph with FramesPerSegment = 3 } } <> [])
check "unknown schema rejected" (validate { project with SchemaVersion = 2 } <> [])
check "NaN rejected" (validate { project with TruncationPsi = nan } <> [])
check "adjacent degenerate pair rejected" (validate { project with Morph = { morph with Controls = [control "A" 0.; control "B" 0.] } } <> [])
check "separate repeated visits allowed" (validate { project with Morph = { morph with Controls = [control "A" 0.; control "B" 1.; control "C" 0.; control "D" 2.] } } = [])
check "duplicate IDs rejected" (validate { project with Morph = { morph with Controls = [control "A" 0.; control "A" 1.] } } <> [])
check "open full smooth rejected" (validate { project with Morph = { morph with Closed = false } } <> [])
let route = { Provider = BrowserWebGpu; Bundle = bundle; AdmissionKey = "session-qualified-fixture" }
let admission = { Route = route; ModelSha256 = hash; NoiseSha256 = hash; LatentShape = [2]; LatentSpace = WPlus; Algorithms = [FullSmoothFigure8, morph.AlgorithmVersion]; VideoExport = true }
let request = { JobId = "job-unique-1"; Project = project; Video = true }
let qualifying, _ = update (Qualify ("attempt-1", route)) init
check "unqualified generation disabled" (fst (update (Start request) init) = init)
check "stale admission ignored" (fst (update (Qualified ("stale", admission)) qualifying) = qualifying)
let ready, _ = update (Qualified ("attempt-1", admission)) qualifying
let running, effects = update (Start request) ready
check "qualified generation effect" (effects = [Generate (route, request)])
check "stale completion ignored" (fst (update (Completed ("old", "bad")) running) = running)
check "overlapping start ignored" (fst (update (Start { request with JobId = "second" }) running) = running)
let badModel = { request with Project = { project with ModelSha256 = String.replicate 64 "b" } }
check "different model blocked" (snd (update (Start badModel) ready) = [])
let cancelling, cancelEffects = update Cancel running
check "cancel requests adapter acknowledgement" (cancelEffects = [CancelJob request.JobId])
check "completion after cancel ignored" (fst (update (Completed (request.JobId, "late")) cancelling) = cancelling)
check "cancel invalidates admission" ((fst (update (Cancelled request.JobId) cancelling)).Status = Unqualified)
let failed, failureEffects = update (Failed (request.JobId, DeviceLost)) running
check "GPU loss disables generation and offers desktop" (failed.Status = Unqualified && List.contains OfferDesktopTransfer failureEffects)
check "NaN progress ignored" (fst (update (Progressed (request.JobId, nan)) running) = running)


open CheckFace.Next
let encoded value = match ProjectJson.encode value with Ok json -> json | Error errors -> failwithf "%A" errors
let json = encoded project
let rejected name value = check name (match ProjectJson.decode value with Error _ -> true | _ -> false)
for pathKind in [Linear; PairwiseEllipse; PairwiseFigure8; FullSmoothEllipse; FullSmoothFigure8] do
    let variant = { project with Morph = { morph with Kind = pathKind } }
    check ("codec roundtrip " + ProjectJson.kindName pathKind) (ProjectJson.decode (encoded variant) = Ok variant)
check "canonical encoding stable" (match ProjectJson.decode json with Ok p -> encoded p = json | _ -> false)
let escapedProject = { project with Bundle = { bundle with Version = "quote\" slash\\ newline\n emoji \U0001f642" } }
check "escaped unicode roundtrip" (ProjectJson.decode (encoded escapedProject) = Ok escapedProject)
check "finite double roundtrip" (ProjectJson.decode (encoded { project with TruncationPsi = 0.12345678901234567 }) = Ok { project with TruncationPsi = 0.12345678901234567 })
rejected "unknown kind" (json.Replace("full-smooth-figure8", "spline-guessed"))
rejected "unknown schema codec" (json.Replace("\"schemaVersion\":1", "\"schemaVersion\":2"))
rejected "duplicate fields" (json.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"))
rejected "unknown field" (json.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"future\":true"))
rejected "missing field" (json.Replace("\"schemaVersion\":1,", ""))
rejected "wrong field type" (json.Replace("\"closed\":true", "\"closed\":\"true\""))
rejected "fractional count" (json.Replace("\"framesPerSegment\":4", "\"framesPerSegment\":4.5"))
rejected "nonfinite exponent" (json.Replace("\"width\":0.2", "\"width\":1e999"))
rejected "shape mismatch" (json.Replace("\"shape\":[2]", "\"shape\":[3]"))
rejected "invalid number grammar" (json.Replace("\"schemaVersion\":1", "\"schemaVersion\":01"))
rejected "trailing content" (json + " null")
rejected "trailing comma" (json.Substring(0, json.Length - 1) + ",}")
rejected "unescaped control" (json.Replace("fixture-v1", "fixture\n"))
rejected "invalid escape" (json.Replace("fixture-v1", "fixture\\q"))
rejected "null input" null
rejected "oversized input" (String.replicate (ProjectJson.MaxInputChars + 1) " ")
rejected "deep input" ((String.replicate 18 "[") + "0" + (String.replicate 18 "]"))
rejected "oversized array" ("[" + (String.replicate 65536 "0,") + "0]")
let manyControls = [for i in 0 .. 64 -> control (string i) (float i)]
check "encoder control limit" (match ProjectJson.encode { project with Morph = { morph with Controls = manyControls } } with Error _ -> true | _ -> false)
check "encoder rejects invalid metadata" (match ProjectJson.encode { project with ModelSha256 = "bad" } with Error _ -> true | _ -> false)
for latentSpace in [Z; W; WPlus] do
    let variant = { project with Morph = { morph with Controls = morph.Controls |> List.map (fun c -> { c with Latent = { c.Latent with Space = latentSpace } }) } }
    check ("space roundtrip " + ProjectJson.spaceName latentSpace) (ProjectJson.decode (encoded variant) = Ok variant)
let mixed = { project with Morph = { morph with Controls = [control "A" 0.; { (control "B" 1.) with Latent = { Space = Z; Shape = [2]; Values = [1.; 0.] } }] } }
check "mixed latent spaces rejected" (validate mixed <> [])
let zRequest = { request with Project = { project with Morph = { morph with Controls = morph.Controls |> List.map (fun c -> { c with Latent = { c.Latent with Space = Z } }) } } }
check "same shape different space admission rejected" (snd (update (Start zRequest) ready) = [])
rejected "missing latent space" (json.Replace("\"space\":\"w-plus\",", ""))
rejected "unknown latent space" (json.Replace("\"space\":\"w-plus\"", "\"space\":\"q\""))
printfn "Passed %d contract/state/JSON checks; no inference or geometry qualification claimed." checks
