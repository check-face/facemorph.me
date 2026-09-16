namespace CheckFace.Next

open Contracts

/// Elm-style state and effects independent of Elmish/React, workers or a desktop shell.
module Runtime =
    type Route = {
        Provider: Provider
        Bundle: Bundle
        /// Canonical model/runtime/kernel/precision/shape/device/build/policy identity.
        AdmissionKey: string
    }
    type Admission = {
        Route: Route
        ModelSha256: string
        NoiseSha256: string
        LatentShape: int list
        LatentSpace: LatentSpace
        Algorithms: (PathKind * string) list
        VideoExport: bool
    }
    type Request = { JobId: string; Project: Project; Video: bool }
    type Failure = DeviceLost | OutOfMemory | IncorrectOutput | WorkerFailed | Unsupported | Other of string
    type Status = Unqualified | Qualifying of string * Route | Ready of Admission | Running of Admission * Request | Cancelling of Admission * Request
    type Model = { Status: Status; Progress: float; Output: string option; Notice: string option }
    type Msg =
        | Qualify of attemptId: string * Route
        | Qualified of attemptId: string * Admission
        | QualificationFailed of attemptId: string * Failure
        | Start of Request
        | Progressed of jobId: string * fraction: float
        | Completed of jobId: string * localArtifactId: string
        | Failed of jobId: string * Failure
        | Cancel
        | Cancelled of jobId: string
        | Invalidate
    type Effect =
        | RunCanaries of attemptId: string * Route
        | Generate of Route * Request
        | CancelJob of string
        | ReleaseRuntime
        | OfferDesktopTransfer
    /// Adapters dispatch events; never write model state or send private inputs to diagnostics.
    type Adapter = { Execute: Effect -> (Msg -> unit) -> unit }

    let init = { Status = Unqualified; Progress = 0.0; Output = None; Notice = None }
    let private disabled reason = { init with Notice = Some reason }, [ReleaseRuntime; OfferDesktopTransfer]
    let update msg model =
        match msg, model.Status with
        | Invalidate, _ -> disabled "Runtime changed; validate a route before generating."
        | Qualify (attempt, route), (Unqualified | Ready _) when not (System.String.IsNullOrWhiteSpace attempt) ->
            { init with Status = Qualifying (attempt, route) }, [ReleaseRuntime; RunCanaries (attempt, route)]
        | Qualified (attempt, admission), Qualifying (current, route) when attempt = current && route = admission.Route ->
            { init with Status = Ready admission }, []
        | QualificationFailed (attempt, _), Qualifying (current, _) when attempt = current ->
            disabled "This route failed validation. Try a separately validated CPU route or desktop."
        | Start request, Ready admission ->
            let errors = validate request.Project
            if not errors.IsEmpty then { model with Notice = Some (String.concat " " errors) }, []
            elif System.String.IsNullOrWhiteSpace request.JobId then { model with Notice = Some "A unique job ID is required." }, []
            elif request.Project.Bundle <> admission.Route.Bundle
                 || request.Project.ModelSha256 <> admission.ModelSha256
                 || request.Project.NoiseSha256 <> admission.NoiseSha256
                 || request.Project.Morph.Controls.Head.Latent.Shape <> admission.LatentShape
                 || request.Project.Morph.Controls.Head.Latent.Space <> admission.LatentSpace
                 || not (List.contains (request.Project.Morph.Kind, request.Project.Morph.AlgorithmVersion) admission.Algorithms)
                 || (request.Video && not admission.VideoExport) then
                { model with Notice = Some "Project runtime, morph or export path needs qualification." }, []
            else
                { model with Status = Running (admission, request); Progress = 0.0; Output = None; Notice = None },
                [Generate (admission.Route, request)]
        | Progressed (id, fraction), Running (_, request)
            when id = request.JobId && fraction >= model.Progress && fraction <= 1.0 ->
            { model with Progress = fraction }, []
        | Completed (id, artifact), Running (admission, request) when id = request.JobId ->
            { model with Status = Ready admission; Progress = 1.0; Output = Some artifact }, []
        | Failed (id, _), (Running (_, request) | Cancelling (_, request)) when id = request.JobId ->
            disabled "Generation failed; validate a fresh route before retrying."
        | Cancel, Running (admission, request) ->
            { model with Status = Cancelling (admission, request) }, [CancelJob request.JobId]
        | Cancelled id, Cancelling (_, request) when id = request.JobId ->
            { init with Notice = Some "Cancelled. Validate the released runtime before continuing." }, [ReleaseRuntime]
        | _ -> model, [] // Late results, duplicate clicks and overlapping jobs are ignored.
