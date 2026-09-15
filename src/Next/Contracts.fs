namespace CheckFace.Next

/// Portable domain types; adapters must use an explicit, versioned JSON codec.
module Contracts =
    type Provider = BrowserCpu | BrowserWebGpu | BrowserWebGl | NativeCpu | NativeGpu
    type Bundle = { Version: string; ManifestSha256: string }
    type LatentSpace = Z | W | WPlus
    type Latent = { Space: LatentSpace; Shape: int list; Values: float list }
    /// Visit IDs are unique; distinct visits may intentionally contain identical latents.
    type Control = { VisitId: string; Latent: Latent }
    type PathKind = Linear | PairwiseEllipse | PairwiseFigure8 | FullSmoothEllipse | FullSmoothFigure8
    type Morph = {
        AlgorithmVersion: string
        Kind: PathKind
        Controls: Control list
        Closed: bool
        Width: float
        PinchCenter: bool
        FramesPerSegment: int
        FramesPerSecond: int
    }
    type Project = {
        SchemaVersion: int
        Bundle: Bundle
        ModelSha256: string
        NoiseSha256: string
        TruncationPsi: float
        TruncationCutoff: int
        Morph: Morph
    }
    type Sample = { Segment: int; U: float; ControlVisit: string option; IsMidpoint: bool }

    let private finite x = not (System.Double.IsNaN x || System.Double.IsInfinity x)
    let private sha256 (s: string) =
        not (isNull s) && s.Length = 64 && (s |> Seq.forall (fun c ->
            (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
    let private nonblank s = not (System.String.IsNullOrWhiteSpace s)

    /// Structural admission only. Model shape support and algorithm qualification are adapter gates.
    let validate (project: Project) =
        let morph = project.Morph
        let controls = morph.Controls
        [
            if project.SchemaVersion <> 1 then yield "Unsupported project schema."
            if not (nonblank project.Bundle.Version && sha256 project.Bundle.ManifestSha256) then
                yield "A versioned, checksummed runtime bundle is required."
            if not (sha256 project.ModelSha256 && sha256 project.NoiseSha256) then
                yield "Exact model and noise assets are required."
            if not (finite project.TruncationPsi) || project.TruncationPsi < 0.0 || project.TruncationCutoff < 0 then
                yield "Invalid truncation settings."
            if not (nonblank morph.AlgorithmVersion) then yield "An algorithm version is required."
            if controls.Length < 2 then yield "At least two ordered controls are required."
            if controls |> List.exists (fun c -> not (nonblank c.VisitId)) then yield "Visit IDs must be nonempty."
            if (controls |> List.map (fun c -> c.VisitId) |> List.distinct |> List.length) <> controls.Length then
                yield "Visit IDs must be unique; repeated latents can use distinct IDs."
            if not (finite morph.Width) || morph.Width < 0.0 then yield "Width must be finite and nonnegative."
            if morph.FramesPerSegment < 2 || morph.FramesPerSegment % 2 <> 0 then
                yield "Use a positive even frame count per segment to include exact midpoint samples."
            if morph.FramesPerSecond < 1 || morph.FramesPerSecond > 240 then yield "Frame rate must be 1–240."
            if not morph.Closed && (morph.Kind = FullSmoothEllipse || morph.Kind = FullSmoothFigure8) then
                yield "Full-smooth open endpoints are not qualified; use a closed path."
            if controls |> List.exists (fun c ->
                c.Latent.Shape.IsEmpty || (c.Latent.Shape |> List.exists (fun n -> n <= 0))
                || (c.Latent.Shape |> List.fold (fun n d -> n * float d) 1.0) <> float c.Latent.Values.Length
                || (c.Latent.Values |> List.exists (finite >> not))) then
                yield "Control latents must have finite values matching positive dimensions."
            match controls with
            | first :: rest when rest |> List.exists (fun c -> c.Latent.Shape <> first.Latent.Shape) ->
                yield "All control latent shapes must match."
            | _ -> ()
            match controls with
            | first :: rest when rest |> List.exists (fun c -> c.Latent.Space <> first.Latent.Space) ->
                yield "All control latent spaces must match; implicit conversion is forbidden."
            | _ -> ()
            let pairs = List.pairwise controls
            let pairs = if morph.Closed && controls.Length > 1 then pairs @ [List.last controls, List.head controls] else pairs
            if pairs |> List.exists (fun (a,b) -> a.Latent.Values = b.Latent.Values) then
                yield "Adjacent identical faces create a degenerate direction; remove that visit."
        ]

    /// Closed schedules omit terminal A; open schedules include their final face once.
    /// Enumeration is lazy so duration does not allocate all frames or latents up front.
    let samples (project: Project) =
        match validate project with
        | errors when not errors.IsEmpty -> Error errors
        | _ ->
            let morph = project.Morph
            let controls = List.toArray morph.Controls
            let segments = if morph.Closed then controls.Length else controls.Length - 1
            Ok (seq {
                for segment in 0 .. segments - 1 do
                    for frame in 0 .. morph.FramesPerSegment - 1 do
                        yield {
                            Segment = segment
                            U = float frame / float morph.FramesPerSegment
                            ControlVisit = if frame = 0 then Some controls.[segment].VisitId else None
                            IsMidpoint = frame = morph.FramesPerSegment / 2
                        }
                if not morph.Closed then
                    yield { Segment = segments - 1; U = 1.0; ControlVisit = Some controls.[controls.Length - 1].VisitId; IsMidpoint = false }
            })
