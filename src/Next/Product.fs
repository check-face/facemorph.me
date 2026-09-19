module NextProduct

open Elmish
open Fable.Core
open Fable.Core.JsInterop
open Feliz
open Feliz.MaterialUI
open Fable.MaterialUI.Icons
open Browser
open Browser.Types
open Config
open FancyButton

[<CLIMutable>]
type Input = { id: string; mode: string; value: string; file: obj }
[<CLIMutable>]
type Face = { id: string; url: string; label: string }
[<CLIMutable>]
type NameFace = { name:string; value:string; image:string }
[<CLIMutable>]
type Progress = { jobId: int; stage: string; text: string; fraction: float; face: string }
[<CLIMutable>]
type Output = { faces: Face array; videoUrl: string; projectJson: string; message: string; errorMessage: string; restored: bool; inputs: Input array; kind: string; width: float; pinch: bool; frames: int; fps: int }
[<CLIMutable>]
type Request = { jobId: int; action: string; target: string; inputs: Input array; kind: string; width: float; pinch: bool; frames: int; fps: int; provider: string }

[<Import("loadNames", "./product-bridge.mjs")>]
let loadNames (): JS.Promise<NameFace array> = jsNative

[<Import("execute", "./product-bridge.mjs")>]
let execute (request: Request): JS.Promise<Output> = jsNative
[<Import("subscribe", "./product-bridge.mjs")>]
let subscribe (callback: Progress -> unit): unit = jsNative
[<Import("cancel", "./product-bridge.mjs")>]
let cancelWork (): unit = jsNative
[<Import("saveMedia", "./product-bridge.mjs")>]
let saveMedia (id: string): JS.Promise<string> = jsNative
[<Import("shareMedia", "./product-bridge.mjs")>]
let shareMedia (id: string): JS.Promise<string> = jsNative
[<Import("exportProject", "./product-bridge.mjs")>]
let exportProject (request: obj): JS.Promise<string> = jsNative
[<Import("importProject", "./product-bridge.mjs")>]
let importProject (request: obj): JS.Promise<Output> = jsNative
[<Import("measuredFaceMs", "./product-bridge.mjs")>]
let measuredFaceMs (): obj = jsNative
[<Import("measuredFrameMs", "./product-bridge.mjs")>]
let measuredFrameMs (): obj = jsNative
[<Import("jobProgress", "./product-bridge.mjs")>]
let jobProgress (): obj = jsNative
[<Import("sliderFrames", "./product-bridge.mjs")>]
let sliderFrames (): JS.Promise<obj> = jsNative
[<Import("plannedFrames", "./product-bridge.mjs")>]
let plannedFrames (options: obj): obj = jsNative
[<Import("stagedReportCount", "./product-bridge.mjs")>]
let stagedReportCount (): int = jsNative
[<Import("reportReference", "./product-bridge.mjs")>]
let reportReference (): string = jsNative
[<Import("cancelPhotoRun", "./product-bridge.mjs")>]
let cancelPhotoRun (): unit = jsNative
[<Import("setDebug", "./product-bridge.mjs")>]
let setDebug (enabled: bool): unit = jsNative

// estimate.mjs turns the measured medians into predictions. One instance, so the pre-run
// estimate, the time-remaining readout and the slow-video warning can never disagree.
[<Import("createEstimator", "./estimate.mjs")>]
let createEstimator (options: obj): obj = jsNative
[<Import("describeMs", "./estimate.mjs")>]
let describeMs (ms: float): string = jsNative
[<Import("isSlowJob", "./estimate.mjs")>]
let isSlowJob (ms: float): bool = jsNative
let private estimator = createEstimator(createObj ["faceMs" ==> measuredFaceMs;"frameMs" ==> measuredFrameMs])

[<Emit("$0 === null || $0 === undefined")>]
let isJsNull (value: obj): bool = jsNative
[<Emit("$0.target.files && $0.target.files[0]")>]
let firstFile (event: obj): obj = jsNative
[<Emit("$0 ? $0.name : ''")>]
let fileName (file: obj): string = jsNative
[<Emit("$0.length")>]
let fileListLength (files: obj): int = jsNative
[<Emit("$0[$1]")>]
let fileAt (files: obj) (index: int): obj = jsNative
[<Emit("[$0]")>]
let oneFile (file: obj): obj = jsNative
[<Emit("window.requestAnimationFrame($0)")>]
let requestAnimationFrame (callback: unit -> unit): int = jsNative

[<Import("previewPhoto", "./product-bridge.mjs")>]
let previewPhoto (file: obj) (options: obj): JS.Promise<obj> = jsNative
[<Emit("Object.assign({crop:true,file:$1},$0)")>]
let cropOffer (preview: obj) (file: obj): obj = jsNative
[<Import("cropPhoto", "./product-bridge.mjs")>]
let cropPhoto (file: obj) (area: obj) (options: obj): JS.Promise<obj> = jsNative
[<Import("createCrop", "./photo/crop-view.mjs")>]
let createCrop (options: obj): obj = jsNative
[<Import("pan", "./photo/crop-view.mjs")>]
let panCrop (state: obj) (dx: float) (dy: float): obj = jsNative
[<Import("zoomTo", "./photo/crop-view.mjs")>]
let zoomCrop (state: obj) (zoom: float): obj = jsNative
[<Import("rotate", "./photo/crop-view.mjs")>]
let rotateCrop (state: obj): obj = jsNative
[<Import("rect", "./photo/crop-view.mjs")>]
let cropRect (state: obj): obj = jsNative
[<Import("frame", "./photo/crop-view.mjs")>]
let cropFrame (state: obj) (viewport: float): obj = jsNative
[<Emit("$0 && $0.crop === true")>]
let isCropOffer (value: obj): bool = jsNative
[<Emit("URL.revokeObjectURL($0)")>]
let revokeUrl (url: string): unit = jsNative

[<Import("photoFiles", "./photo-selection.mjs")>]
let photoFiles (event: obj): obj = jsNative
[<Import("selectPhoto", "./product-bridge.mjs")>]
let selectPhoto (request: obj): JS.Promise<obj> = jsNative
[<Import("openPhotoPicker", "./photo-selection.mjs")>]
let openPhotoPicker (id: string): unit = jsNative
[<Import("dragPhoto", "./photo-selection.mjs")>]
let dragPhoto (event: obj) (busy: bool) (leaving: bool): unit = jsNative
[<Import("invalidatePhotoSelections", "./photo-selection.mjs")>]
let invalidatePhotoSelections (): unit = jsNative
[<Import("focusCropArea", "./photo-selection.mjs")>]
let focusCropArea (): unit = jsNative
[<Import("openNamesFocus", "./photo-selection.mjs")>]
let openNamesFocus (): unit = jsNative
[<Import("closeNamesFocus", "./photo-selection.mjs")>]
let closeNamesFocus (): unit = jsNative
[<Import("namesKey", "./photo-selection.mjs")>]
let namesKey (event: obj) (close: unit -> unit): unit = jsNative

type State = {
    Inputs: Input list; Faces: Face array; VideoUrl: string
    Kind: string; Width: float; Pinch: bool; Frames: int; Fps: int; Provider: string
    Busy: bool; JobId: int; Stage: string; Status: string; Fraction: float
    Browse: string option; Names: NameFace array; NameQuery: string; NameLimit: int; Error: string option; DebugStatus: string; Debug: bool; NextId: int
    Crop: CropChoice option
    Route: string
    Rejected: string option
    Invite: bool
    UseSlider: bool; SliderFrames: string array option
    Warn: string option; Overflow: bool; PhotoQueue: (string * obj) list
    PendingFaces: string list
    ActiveFace: string option
    Remaining: string
}
and [<CLIMutable>] CropChoice = { faceId: string; url: string; file: obj; scale: float; view: obj }
type Msg =
    | Edit of string * string | Mode of string * string | Photo of string * obj
    | PickPhoto of string * obj | PhotoError of string
    | Photos of string option * obj | AddAt of int | Remove of string | Kind of string
    | Frames of int | Provider of string | Run of string | RunFace of string | Cancel
    | Progressed of Progress | Completed of int * Output | Failed of int * string
    | Save of string | Share of string | Export | Import of obj | Notice of string
    | Debug of bool | DismissError | DismissInvite | DismissWarn | OverflowToggle of bool
    | UseSliderToggle of bool | SliderLoaded of obj
    | BrowseNames of string | NamesLoaded of NameFace array | SearchNames of string | ChooseName of string | CloseNames | MoreNames
    | CropPan of float * float | CropZoom of float | CropRotate | CropAccept | CropCancel | RequestCrop of string | Cropped of string * obj

[<Emit("window.location.pathname === '/names' || window.location.pathname === '/names/' || new URLSearchParams(window.location.search).has('names')")>]
let namesRequested (): bool = jsNative

// A link handed to testers. It invites reporting prominently instead of waiting for something to
// break, but it still only ever invites: nothing is enabled or sent until the tester says yes.
[<Emit("new URLSearchParams(window.location.search).has('testing')")>]
let testingInvited (): bool = jsNative

let emptyFile: obj = null
let init () =
    { Inputs = [{id="face-1";mode="text";value="hello";file=emptyFile}; {id="face-2";mode="text";value=System.DateTime.Today.ToString("yyyy-MM-dd");file=emptyFile}]
      Faces=[||];VideoUrl="";Kind="pairwise-figure8";Width=0.2;Pinch=false;Frames=16;Fps=16;Provider="auto"
      Busy=false;JobId=0;Stage="idle";Status="";Fraction=0.;Browse=None;Names=[||];NameQuery="";NameLimit=48;Error=None;DebugStatus="";Debug=false;NextId=3;Crop=None;Route="";Rejected=None;Invite=testingInvited()
      UseSlider=false;SliderFrames=None;Warn=None;Overflow=false;PhotoQueue=[];PendingFaces=[];ActiveFace=None;Remaining="" },
    Cmd.batch [Cmd.ofSub(fun dispatch -> subscribe (Progressed >> dispatch)); if namesRequested() then Cmd.ofMsg(BrowseNames "face-1")]

/// Time left in the job in flight, spoken. Empty without a measurement on this device.
/// R2-13: remaining() takes LEFT counts; feeding it jobProgress' done counts made this read
/// "about about 1 seconds remaining" forever. describeMs already speaks "about", no prefix here.
let private remainingText () =
    let jp = jobProgress()
    let facesLeft = (jp?facesTotal: float) - (jp?facesDone: float)
    let framesLeft = (jp?framesTotal: float) - (jp?framesDone: float)
    let ms = estimator?remaining(createObj ["facesLeft" ==> facesLeft;"framesLeft" ==> framesLeft])
    if isJsNull ms then "" else describeMs(unbox<float> ms) + " remaining"

/// Per-frame cost this device has measured, spoken. Empty without a measurement.
let private perFrameText () =
    match measuredFrameMs() with
    | null -> (match measuredFaceMs() with null -> "" | value -> sprintf "about %s per frame" (describeMs(unbox<float> value)))
    | value -> sprintf "about %s per frame" (describeMs(unbox<float> value))

/// Predicted total for the morph as currently configured, from measurement only.
let private predictedMorphMs (state:State) =
    match plannedFrames(createObj ["inputs" ==> Array.ofList state.Inputs;"kind" ==> state.Kind;"width" ==> state.Width;"pinch" ==> state.Pinch;"frames" ==> state.Frames;"fps" ==> state.Fps]) with
    | null -> None
    | frames ->
        let ms = estimator?predict(createObj ["faces" ==> state.Inputs.Length;"frames" ==> unbox<float> frames])
        if isJsNull ms then None else Some(unbox<float> ms)

/// Guidance follows evidence, not the route's name: a qualified GPU route can still be slow
/// on a given machine, and this device has already shown what a face costs it.
let private isSlowDevice (state:State) =
    match measuredFaceMs() with
    | null -> state.Route="cpu"
    | value -> unbox<float> value > 20000. || state.Route="cpu"

let update msg state =
    let change id f = {state with Inputs=state.Inputs |> List.map(fun item -> if item.id=id then f item else item); VideoUrl="";Status=""}
    let noticeTask fn arg = Cmd.OfPromise.either fn arg Notice (fun _ -> Notice "Couldn't save or share this file. Try Save instead.")
    /// Continues a multi-photo drop with the next queued photo, if any.
    let dequeue (state:State) =
        match state.PhotoQueue with
        | (id,file)::rest ->
            {state with PhotoQueue=rest},
            Cmd.OfPromise.either selectPhoto (createObj ["id" ==> id;"files" ==> oneFile file]) (fun result -> Photo(id,result)) (fun e -> PhotoError e.Message)
        | [] -> state,Cmd.none
    match msg with
    | Edit(id,value) when not state.Busy ->
        invalidatePhotoSelections(); change id (fun item -> {item with value=if item.mode="seed" then value |> String.filter System.Char.IsDigit else value}), Cmd.none
    | Mode(id,mode) when not state.Busy -> invalidatePhotoSelections(); change id (fun item -> {item with mode=mode;file=emptyFile}), Cmd.none
    | PickPhoto(id,files) when not state.Busy -> state,Cmd.OfPromise.either selectPhoto (createObj ["id" ==> id;"files" ==> files]) (fun file -> Photo(id,file)) (fun e -> PhotoError e.Message)
    | Cropped(id,file) when not (isNull file) ->
        // CropAccept raised Busy itself ("Preparing your crop…"): by the time the rendered
        // crop lands, that flag is the crop's own, not a run's. Leaving it set made the
        // idle-accept path see Busy and queue the face into PendingFaces, where nothing
        // would ever dispatch it - a stuck "busy" with no run. A crop accepted while a real
        // run is in flight keeps Busy and queues, exactly as before.
        let cropOwnsBusy=state.Stage="cropping"
        let next={change id (fun item -> {item with mode="photo";file=file;value=fileName file}) with Error=None;Busy=(if cropOwnsBusy then false else state.Busy)}
        let (queued,queuedCmd)=dequeue next
        // The crop IS the photo choice. With no run in flight and no queued photo, the e4e
        // encode for this face starts now instead of waiting for a second button press.
        // While another face IS still encoding, the accepted crop must not clobber that
        // run's progress state: the face joins PendingFaces and starts on completion.
        if queued.Busy then {queued with PendingFaces=queued.PendingFaces@[id]},queuedCmd
        elif queued.PhotoQueue.Length>0 then queued,queuedCmd
        else queued,Cmd.batch [queuedCmd;Cmd.ofMsg (RunFace id)]
    | PhotoError message when not state.Busy || state.Stage="cropping" ->
        let next={state with Error=Some message;Busy=false;Stage=(if state.Stage="cropping" then "idle" else state.Stage);Status=""}
        dequeue next
    // A photo the alignment route cannot take whole opens the crop step first; only the crop
    // is ever aligned. Cancelling leaves the existing face and its inputs alone.
    | Photo(id,offer) when state.ActiveFace<>Some id && not (isNull offer) && isCropOffer offer ->
        state.Crop |> Option.iter (fun previous -> revokeUrl previous.url)
        focusCropArea()
        {state with Error=None;Crop=Some {faceId=id;url=offer?url;file=offer?file;scale=offer?scale
                                          view=createCrop(createObj ["previewWidth" ==> offer?previewWidth;"previewHeight" ==> offer?previewHeight;"scale" ==> offer?scale;"viewport" ==> 320.])}},Cmd.none
    | RequestCrop id when state.ActiveFace<>Some id ->
        match state.Inputs |> List.tryFind(fun item -> item.id=id) with
        | Some item when not (isNull item.file) ->
            state,Cmd.OfPromise.either (fun () -> previewPhoto item.file null) () (fun preview -> Photo(id,cropOffer preview item.file)) (fun e -> PhotoError e.Message)
        | _ -> state,Cmd.none
    | CropPan(dx,dy) ->
        match state.Crop with
        | Some crop -> {state with Crop=Some {crop with view=panCrop crop.view dx dy}},Cmd.none
        | None -> state,Cmd.none
    | CropZoom zoom ->
        match state.Crop with
        | Some crop -> {state with Crop=Some {crop with view=zoomCrop crop.view zoom}},Cmd.none
        | None -> state,Cmd.none
    | CropRotate ->
        match state.Crop with
        | Some crop -> {state with Crop=Some {crop with view=rotateCrop crop.view}},Cmd.none
        | None -> state,Cmd.none
    | CropCancel ->
        cancelPhotoRun()
        state.Crop |> Option.iter (fun crop -> revokeUrl crop.url)
        let next={state with Crop=None}
        dequeue next
    | CropAccept ->
        match state.Crop with
        | Some crop ->
            let options=createObj ["previewScale" ==> crop.scale;"rotation" ==> crop.view?rotation]
            let target=crop.faceId
            revokeUrl crop.url
            // Rendering the crop is real work: hold the controls until it lands, so nothing can
            // be generated from the previous photo while the crop is still being prepared.
            {state with Crop=None;Busy=true;Stage="cropping";Status="Preparing your crop…";Fraction=0.},
            Cmd.OfPromise.either (fun () -> cropPhoto crop.file (cropRect crop.view) options) () (fun file -> Cropped(target,file)) (fun e -> PhotoError e.Message)
        | None -> state,Cmd.none
    | Photo(id,file) when not state.Busy && not (isNull file) ->
        // Direct accept (no crop needed): same eager-e4e rule as Cropped — the choice of
        // photo IS the instruction to encode it. Busy here is impossible (guard above), but
        // a multi-photo drop queues more selections; those faces encode as each lands.
        let (next,nextCmd)=dequeue {change id (fun item -> {item with mode="photo";file=file;value=fileName file}) with Error=None;Status=""}
        if next.PhotoQueue.Length>0 then next,nextCmd
        else next,Cmd.batch [nextCmd;Cmd.ofMsg (RunFace id)]
    // A drop of one or more photos: the named tile (or the first empty face) takes the first,
    // and every further file creates its own face, in drop order.
    | Photos(optId,files) when not state.Busy && not (isNull files) && fileListLength files>0 ->
        invalidatePhotoSelections()
        let count=fileListLength files
        let mutable inputs=state.Inputs
        let targets=System.Collections.Generic.List<string>()
        let firstEmpty = state.Inputs |> List.tryFindIndex(fun item -> item.mode<>"photo" && item.mode<>"project" && System.String.IsNullOrWhiteSpace item.value)
        let mutable emptyLeft = firstEmpty
        let appendFace () =
            let id="face-"+System.Guid.NewGuid().ToString("N")
            inputs <- inputs @ [{id=id;mode="text";value="";file=emptyFile}];id
        match optId with
        | Some id -> targets.Add id
        | None ->
            match emptyLeft with
            | Some index when index < List.length inputs -> targets.Add((List.item index inputs).id); emptyLeft <- None
            | _ -> targets.Add(appendFace ())
        for _ in 2..count do targets.Add(appendFace ())
        let firstId=targets.[0]
        let queue=[for i in 1..count-1 -> (targets.[i], fileAt files i)]
        {state with Inputs=inputs;PhotoQueue=queue;Error=None},
        Cmd.OfPromise.either selectPhoto (createObj ["id" ==> firstId;"files" ==> oneFile (fileAt files 0)]) (fun result -> Photo(firstId,result)) (fun e -> PhotoError e.Message)
    | AddAt position when not state.Busy && state.Inputs.Length<64 ->
        let newFace={id="face-"+System.Guid.NewGuid().ToString("N");mode="text";value="";file=emptyFile}
        let (before,after)=state.Inputs |> List.indexed |> List.partition(fun (i,_) -> i<position)
        {state with Inputs=(before |> List.map snd) @ [newFace] @ (after |> List.map snd);NextId=state.NextId+1;VideoUrl=""},Cmd.none
    | Remove id when not state.Busy && state.Inputs.Length>1 -> invalidatePhotoSelections(); {state with Inputs=state.Inputs |> List.filter(fun x -> x.id<>id);VideoUrl=""},Cmd.none
    | Kind value when not state.Busy -> {state with Kind=value;VideoUrl=""},Cmd.none
    | Frames value when not state.Busy -> {state with Frames=value;VideoUrl=""},Cmd.none
    | Provider value when not state.Busy -> {state with Provider=value},Cmd.none
    | OverflowToggle expanded -> {state with Overflow=expanded},Cmd.none
    | RunFace faceId when not state.Busy ->
        match state.Inputs |> List.tryFind(fun item -> item.id=faceId) with
        | None -> state,Cmd.none
        | Some item ->
            invalidatePhotoSelections()
            let id=state.JobId+1
            let request={jobId=id;action="face";target=faceId;inputs=[|item|];kind=state.Kind;width=state.Width;pinch=state.Pinch;frames=state.Frames;fps=state.Fps;provider=state.Provider}
            {state with Busy=true;JobId=id;Error=None;Stage="preparing";Status="Generating this face…";Fraction=0.;VideoUrl="";Warn=None;Remaining="";SliderFrames=None;PhotoQueue=[]},
            Cmd.OfPromise.either execute request (fun result -> Completed(id,result)) (fun e -> Failed(id,e.Message))
    | Run action when not state.Busy ->
        invalidatePhotoSelections()
        let id=state.JobId+1
        // Slow-video warning (U-12): a measured prediction above the threshold is spoken,
        // never blocking — the job starts and the warning can be dismissed. The run itself
        // never waits on an answer.
        let warn =
            if action<>"morph" then None
            else match predictedMorphMs state with
                 | Some ms when isSlowJob ms -> Some (sprintf "This video may take %s on this device. It keeps going if you switch tabs, and you can cancel at any time." (describeMs ms))
                 | _ -> if isSlowDevice state then Some "Generating is slow on this device, so this video may take a while. You can cancel at any time." else None
        let request={jobId=id;action=action;target="";inputs=Array.ofList state.Inputs;kind=state.Kind;width=state.Width;pinch=state.Pinch;frames=state.Frames;fps=state.Fps;provider=state.Provider}
        {state with Busy=true;JobId=id;Error=None;Stage="preparing";Status="Preparing…";Fraction=0.;Warn=warn;Remaining="";SliderFrames=None;PhotoQueue=[];ActiveFace=None},
        Cmd.OfPromise.either execute request (fun result -> Completed(id,result)) (fun e -> Failed(id,e.Message))
    | Progressed progress when progress.stage.StartsWith("diagnostics-") ->
        let status = match progress.stage with
                     | "diagnostics-sent" -> "Report saved. Reference: " + progress.text
                     | "diagnostics-failed" -> "Report could not be saved. You can still email us."
                     | "diagnostics-enabled" -> "Reporting is on. It stays on until you turn it off."
                     | _ -> "Reporting is off."
        {state with DebugStatus=status;Debug=(match progress.stage with | "diagnostics-enabled" -> true | "diagnostics-disabled" -> false | _ -> state.Debug)},Cmd.none
    | Progressed progress when progress.stage="route-admitted" ->
        {state with Route=progress.text},Cmd.none
    | Progressed progress when progress.stage="route-rejected" ->
        // C-02: the interface names which route was refused. The route now in use arrives
        // separately as route-admitted, so Rejected stands next to Route in the caption.
        {state with Rejected=Some progress.text},Cmd.none
    | Progressed progress when state.Busy && progress.jobId=state.JobId ->
        let activeFace = if progress.stage="face" && not (isJsNull (box progress.face)) then Some progress.face else state.ActiveFace
        {state with Stage=progress.stage;Status=progress.text;Fraction=progress.fraction;ActiveFace=activeFace;Remaining=remainingText()},Cmd.none
    | Completed(id,result) when id=state.JobId ->
        let next={state with Inputs=(if result.restored then List.ofArray result.inputs else state.Inputs);Kind=(if result.restored then result.kind else state.Kind);Width=(if result.restored then result.width else state.Width);Pinch=(if result.restored then result.pinch else state.Pinch);Frames=(if result.restored then result.frames else state.Frames);Fps=(if result.restored then result.fps else state.Fps);Busy=false;Faces=result.faces;VideoUrl=result.videoUrl;Status=result.message;Error=(if result.errorMessage="" then None else Some result.errorMessage);Stage=(if result.errorMessage="" then "done" else "error");Fraction=(if result.errorMessage="" then 1. else 0.);Warn=None;Remaining="";ActiveFace=None;PhotoQueue=[]}
        let drained={next with PendingFaces=[]}
        let pendingRun=match next.PendingFaces with | head::_ -> Cmd.ofMsg (RunFace head) | [] -> Cmd.none
        let sliderCmd=if result.videoUrl<>"" && state.UseSlider then Cmd.OfPromise.either sliderFrames () SliderLoaded (fun _ -> SliderLoaded null) else Cmd.none
        drained,Cmd.batch [sliderCmd;pendingRun]
    | Failed(id,message) when id=state.JobId ->
        let next={state with Busy=false;Error=Some message;Status="";Stage="error";Fraction=0.;Warn=None;Remaining="";ActiveFace=None}
        // A failed run still drains queued faces: the second face was cropped on purpose.
        match next.PendingFaces with
        | head::_ -> {next with PendingFaces=[]},Cmd.ofMsg (RunFace head)
        | [] -> next,Cmd.none
    | Cancel when state.Busy -> cancelWork(); {state with Stage="cancelling";Status="Cancelling…"},Cmd.none
    | Save id -> state,noticeTask saveMedia id
    | Share id -> state,noticeTask shareMedia id
    | Export when not state.Busy ->
        let options=createObj ["inputs" ==> Array.ofList state.Inputs;"kind" ==> state.Kind;"width" ==> state.Width;"pinch" ==> state.Pinch;"frames" ==> state.Frames;"fps" ==> state.Fps]
        state,Cmd.OfPromise.either exportProject options Notice (fun e -> Notice e.Message)
    | Import file when not state.Busy && not (isNull file) ->
        invalidatePhotoSelections()
        let id=state.JobId+1
        {state with Busy=true;JobId=id;Stage="importing";Status="Opening project…";PhotoQueue=[]},
        Cmd.OfPromise.either importProject (createObj ["file" ==> file; "jobId" ==> id; "provider" ==> state.Provider]) (fun result -> Completed(id,result)) (fun e -> Failed(id,e.Message))
    | Notice text -> {state with Status=text},Cmd.none
    | Debug enabled -> setDebug enabled;{state with Debug=enabled;Invite=false},Cmd.none
    | DismissInvite -> {state with Invite=false},Cmd.none
    | DismissWarn -> {state with Warn=None},Cmd.none
    | UseSliderToggle want ->
        {state with UseSlider=want},
        if want && state.SliderFrames.IsNone && state.VideoUrl<>"" then Cmd.OfPromise.either sliderFrames () SliderLoaded (fun _ -> SliderLoaded null) else Cmd.none
    | SliderLoaded frames ->
        {state with SliderFrames=(if isNull frames then None else Some (unbox<string array> frames))},Cmd.none
    | BrowseNames id when not state.Busy -> openNamesFocus(); {state with Browse=Some id;NameQuery="";NameLimit=48},(if state.Names.Length=0 then Cmd.OfPromise.either loadNames () NamesLoaded (fun e -> Notice e.Message) else Cmd.none)
    | NamesLoaded names -> {state with Names=names},Cmd.none
    | SearchNames text -> {state with NameQuery=text;NameLimit=48},Cmd.none
    | ChooseName value when not state.Busy ->
        invalidatePhotoSelections()
        closeNamesFocus()
        match state.Browse with
        | Some id -> {change id (fun item -> {item with mode="text";value=value;file=emptyFile}) with Browse=None},Cmd.none
        | None -> state,Cmd.none
    | CloseNames -> closeNamesFocus(); {state with Browse=None},Cmd.none
    | MoreNames -> {state with NameLimit=state.NameLimit+48},Cmd.none
    | DismissError -> {state with Error=None},Cmd.none
    | _ -> state,Cmd.none

// Pointer drag needs the previous position between events; the view itself stays declarative.
let mutable dragStart : (float * float) option = None

// --- The measured estimate, spoken where the action happens -------------------------------

/// Estimates only from what this device has already done; no measurement, no estimate.
let estimate (state:State) =
    match measuredFaceMs() with
    | null -> None
    | value ->
        let perFace: float = unbox value
        match plannedFrames(createObj ["inputs" ==> Array.ofList state.Inputs;"kind" ==> state.Kind;"width" ==> state.Width;"pinch" ==> state.Pinch;"frames" ==> state.Frames;"fps" ==> state.Fps]) with
        | null -> Some(perFace, 0.)
        | frames -> Some(perFace, unbox<float> frames)

// --- Progress, drawn with transforms only --------------------------------------------------
// Stage events land many times a second on a cold load; the fill is written once per frame,
// via requestAnimationFrame, and only ever as `transform: scaleX`. No layout is touched.

let private pendingFills = System.Collections.Generic.Dictionary<obj,float>()
let private flushScheduled = ref false
[<Emit("$0.style.transform = $1")>]
let private setTransform (element:obj) (transform:string): unit = jsNative
let private flushFills () =
    flushScheduled.Value <- false
    for entry in pendingFills do
        setTransform entry.Key (sprintf "scaleX(%g)" entry.Value)
    pendingFills.Clear()
let private scheduleFill (element:obj) (fraction:float) =
    if not (isNull element) then
        pendingFills.[element] <- fraction
        if not flushScheduled.Value then
            flushScheduled.Value <- true
            requestAnimationFrame flushFills |> ignore

/// The thin animated-gradient bar. `fraction` below zero renders an indeterminate sweep.
let progressBar (fraction:float) =
    Html.div [prop.className "next-progress";prop.children [
        if fraction<0. then
            Html.div [prop.className "next-progress-fill next-progress-indeterminate"]
        else
            Html.div [prop.className "next-progress-fill";prop.ref(fun el -> scheduleFill el fraction)]]]

// --- Face tiles ----------------------------------------------------------------------------
// The classic idiom: one outlined, centre-aligned text field per face with adornments that
// surface on hover or focus, a photo above it, and controls that get out of the way.

type FieldProps = {
    Item: Input; Label: string; Disabled: bool
    OnEdit: string -> unit; OnMode: string -> unit; OnBrowse: unit -> unit; OnPick: unit -> unit
}

[<ReactComponent>]
let private setpointField (props:FieldProps) =
    let anchorEl = React.useRef None
    let (menuOpen, setMenuOpen) = React.useState false
    let modeMenuItem (kind:string) (icon:ReactElement) (text:string) =
        Mui.menuItem [menuItem.selected (props.Item.mode=kind);prop.onClick(fun _ -> setMenuOpen false; props.OnMode kind)
                      menuItem.children [Mui.listItemIcon [icon];Mui.listItemText text]]
    let endAdornment =
        match props.Item.mode with
        | "photo" ->
            Mui.inputAdornment [inputAdornment.position.end';prop.children [
                Mui.tooltip [tooltip.title "Choose another photo";tooltip.children (
                    Mui.iconButton [prop.className "next-adornment";prop.tabIndex -1;prop.ariaLabel "Choose photo"
                                    iconButton.edge.end';iconButton.children (photoCameraIcon []);prop.onClick(fun _ -> props.OnPick())])]]]
        | "seed" -> Mui.inputAdornment [inputAdornment.position.end';prop.children [Html.fragment []]]
        | _ ->
            Mui.inputAdornment [inputAdornment.position.end';prop.children [
                Mui.tooltip [tooltip.title "Browse names";tooltip.children (
                    Mui.iconButton [prop.className "next-adornment";prop.tabIndex -1;prop.ariaLabel "Browse names"
                                    iconButton.edge.end';iconButton.children (imageSearchIcon []);prop.onClick(fun _ -> props.OnBrowse())])]]]
    let placeholder = match props.Item.mode with | "seed" -> "Input an integer seed" | "project" -> "" | _ -> "Just type anything"
    Mui.noSsr [
        Mui.menu [menu.anchorEl (anchorEl :?> IRefValue<Option<Element>>);menu.keepMounted true;menu.open' menuOpen;menu.onClose(fun _ -> setMenuOpen false)
                  menu.children [
            modeMenuItem "text" (textFieldsIcon []) "Name or words"
            modeMenuItem "seed" (dialpadIcon []) "Numeric seed"
            modeMenuItem "photo" (photoCameraIcon []) "Upload image"
            if props.Item.mode="project" then modeMenuItem "project" (refreshIcon []) "Saved project face"
        ]]
        Html.div [prop.className "next-field";prop.children [
            Mui.textField [
                textField.value (match props.Item.mode with | "photo" -> fileName props.Item.file | _ -> props.Item.value)
                textField.placeholder placeholder
                textField.disabled (props.Disabled || props.Item.mode="photo" || props.Item.mode="project")
                textField.variant.outlined
                textField.label props.Label
                textField.onChange props.OnEdit
                prop.className "focuswithin-parent"
                textField.inputProps [
                    prop.style [style.textAlign.center]
                    if props.Item.mode="seed" then prop.min 0.
                    if props.Item.mode="seed" then prop.max 4294967295.
                ]
                yield! (if props.Item.mode="seed" then [textField.type' "number"] else [])
                textField.InputProps [
                    prop.custom ("startAdornment",
                        Mui.inputAdornment [
                            inputAdornment.position.start
                            prop.ref anchorEl
                            prop.children [
                                Mui.tooltip [tooltip.title "Change mode";tooltip.children (
                                    Mui.iconButton [prop.className "focuswithin-child next-adornment";prop.tabIndex -1;prop.ariaLabel "Change mode"
                                                    iconButton.edge.start;iconButton.children (menuIcon []);prop.onClick(fun _ -> setMenuOpen true)])]]
                        ])
                    prop.custom ("endAdornment", endAdornment)
                ]
            ]]]]

let viewFace (state:State) dispatch (index:int) (item:Input) (label:string) =
    let face = state.Faces |> Array.tryFind(fun f -> f.id=item.id)
    let active = state.ActiveFace = Some item.id
    Html.section [prop.key item.id
                  prop.className ("next-face box" + (if active then " next-face-active" else ""))
                  prop.custom("data-next-face",item.id)
                  prop.custom("data-next-state",(match item.mode with | "photo" -> "photo" | "project" -> "project" | _ -> if face.IsSome then "filled" else "empty"))
                  prop.onDragOver(fun e -> dragPhoto e state.Busy false)
                  prop.onDragLeave(fun e -> dragPhoto e state.Busy true)
                  prop.onDrop(fun e ->
                    dragPhoto e state.Busy true
                    if not state.Busy then
                        let files=photoFiles e
                        dispatch(if fileListLength files>1 then Photos(Some item.id,files) else PickPhoto(item.id,files)))
                  prop.children [
        Html.input [prop.id ("photo-"+item.id);prop.type'.file;prop.hidden true;prop.accept "image/*";prop.ariaLabel "Choose photo";prop.onChange(fun (e:Browser.Types.Event) -> dispatch(PickPhoto(item.id,photoFiles e)))]
        Html.div [prop.className "next-face-image";prop.children [
            match face with
            | Some f -> Html.img [prop.src f.url;prop.alt (sprintf "Generated face from %s" label);prop.width 1024;prop.height 1024;prop.className "next-face-img"]
            | None ->
                // The empty tile is a photo drop target, never a bare plus: the plus belongs to
                // the insertion connector between faces, and the two must not be mistaken.
                Html.button [prop.type'.button;prop.className "next-face-empty";prop.tabIndex -1
                             prop.ariaLabel "Choose photo";prop.onClick(fun _ -> openPhotoPicker item.id)
                             prop.children [photoIcon [];Html.span "Drop a photo, or tap to choose"]]
            if active then Html.div [prop.className "next-face-progress";prop.children [Html.div [prop.className "next-face-progress-fill"]]]]]
        setpointField {Item=item;Label=label;Disabled=false
                       OnEdit=(fun value -> dispatch(Edit(item.id,value)));OnMode=(fun mode -> dispatch(Mode(item.id,mode)))
                       OnBrowse=(fun () -> dispatch(BrowseNames item.id));OnPick=(fun () -> openPhotoPicker item.id)}
        // Compatibility and state mirror for tooling that reads the per-face source as a
        // select (next-e2e does). Mode is changed through the field's mode menu; this control
        // is deliberately not focusable, so the field stays the one tab stop per face.
        Html.select [prop.className "next-sr";prop.value item.mode;prop.tabIndex -1;prop.disabled true;prop.ariaLabel "Face source";prop.onChange(fun (_:string) -> ())
                     prop.children((if item.mode="project" then ["project","Saved project face"] else []) @ ["text","Name or words";"seed","Seed";"photo","Photo"]
                                   |> List.map(fun (key,text) -> Html.option [prop.value key;prop.text text]))]
        if item.mode="photo" then
            Html.div [prop.className "next-file";prop.children [
                Html.span item.value
                Mui.button [button.variant.text;button.size.small;button.disabled ((state.ActiveFace=Some item.id) || isNull item.file)
                            prop.onClick(fun _ -> dispatch(RequestCrop item.id));button.children "Crop photo"]]]
        let faceReady =
            match item.mode with
            | "text" | "seed" -> not (System.String.IsNullOrWhiteSpace item.value)
            | "photo" -> not (isNull item.file)
            | _ -> false
        if face.IsSome || faceReady then
            // Per-face generate (U-03): regenerating one face never synthesises any other.
            // Text and seed faces get the button too: typing a name is the input, and the
            // button is how that one face is generated without touching the others.
            FancyButton [button.variant.contained;button.size.small;prop.className "next-face-generate"
                         button.disabled state.Busy;prop.onClick(fun _ -> dispatch(RunFace item.id));button.children "Generate"]
        Html.div [prop.className "next-actions next-face-actions";prop.children [
            if face.IsSome then
                Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch(Share item.id));button.children "Share image"]
                Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch(Save item.id));button.children "Save image"]
            if state.Inputs.Length>1 then
                Mui.tooltip [tooltip.title (sprintf "Remove %s" label);tooltip.children (
                    Mui.iconButton [prop.className "next-adornment";prop.tabIndex -1;prop.ariaLabel (sprintf "Remove %s" label);prop.disabled state.Busy
                                    iconButton.children (removeIcon []);prop.onClick(fun _ -> dispatch(Remove item.id))])]]]]]

/// Insertion connectors: a morph is a path, so the meaningful action is "insert here", and the
/// connector is the only thing on the surface that draws a plus.
let connector (state:State) dispatch (position:int) (label:string) =
    Html.div [prop.className "next-connector";prop.children [
        Mui.iconButton [prop.className "next-connector-add";prop.ariaLabel label;prop.disabled state.Busy
                        prop.onClick(fun _ -> dispatch(AddAt position));iconButton.children (addIcon [])]]]

let private faceLabel (index:int) (item:Input) =
    match index with
    | 0 -> "Morph from"
    | 1 -> "Morph to"
    | _ -> sprintf "Face %d" (index+1)

let private tilesWithConnectors (state:State) dispatch =
    let pairs = state.Inputs |> List.indexed |> List.collect(fun (index,item) ->
        [connector state dispatch index (sprintf "Add a face before %s" (faceLabel index item));viewFace state dispatch index item (faceLabel index item)])
    let closing = connector state dispatch state.Inputs.Length (sprintf "Add a face after Face %d" state.Inputs.Length)
    pairs @ [closing]

// --- Morph controls, overflow, video and slider ---------------------------------------------

let private shapeOptions = ["pairwise-figure8","Figure eight";"pairwise-ellipse","Ellipse";"full-smooth-figure8","Smooth figure eight";"full-smooth-ellipse","Smooth ellipse";"linear","Classic linear"]
let private lengthOptions = [8,"Length: short";16,"Length: standard";32,"Length: long"]

let private lengthLabel (frames:int) =
    match lengthOptions |> List.tryFind(fun (value,_) -> value=frames) with
    | Some (_,label) -> label
    | None -> sprintf "Length: %d frames" frames

/// The overflow (D-17): morph shape and video length live here, not on the main surface.
/// Width, pinch and raw frame counts are gone from the user surface entirely (U-09).
let private overflow (state:State) dispatch =
    let canShape = state.Inputs.Length>=2
    Html.div [prop.className "next-overflow";prop.children [
        Html.label [prop.className "next-overflow-field";prop.children [
            Html.span "Morph shape"
            Html.select [prop.value state.Kind;prop.disabled state.Busy;prop.ariaLabel "Morph shape";prop.onChange(fun (v:string) -> dispatch(Kind v))
                         prop.children(shapeOptions |> List.map(fun (key,text) -> Html.option [prop.value key;prop.text text]))]]]
        Html.label [prop.className "next-overflow-field";prop.children [
            Html.span (lengthLabel state.Frames)
            Html.select [prop.value (string state.Frames);prop.disabled state.Busy;prop.ariaLabel "Morph length";prop.onChange(fun (v:string) -> dispatch(Frames(int v)))
                         prop.children(
                            (lengthOptions |> List.map(fun (value,label) -> Html.option [prop.value (string value);prop.text label]))
                            @ (if lengthOptions |> List.exists(fun (value,_) -> value=state.Frames) then []
                              else [Html.option [prop.value (string state.Frames);prop.text (sprintf "%d frames" state.Frames)]]))]]]
        if not canShape then Html.p [prop.className "next-overflow-reason";prop.text "Add a second face to shape a morph — shape and length describe the path between faces."]]]

let private morphSlot (state:State) dispatch =
    let canMorph = state.Inputs.Length>=2
    Html.div [prop.className "next-morph-slot";prop.children [
        FancyButton [button.variant.contained;button.size.large;prop.className "next-primary-action"
                     prop.custom("data-next-primary","true");prop.type'.button
                     button.disabled (state.Busy || not canMorph)
                     prop.onClick(fun _ -> dispatch(Run "morph"))
                     button.children "Create morph"]
        Html.div [prop.className "next-actions next-generate";prop.children [
            Mui.button [button.variant.outlined;prop.disabled state.Busy;prop.onClick(fun _ -> dispatch(Run "faces"));button.children "Generate faces"]
            Mui.button [button.variant.text;prop.disabled (state.Busy || not canMorph)
                        prop.custom("aria-expanded",state.Overflow);prop.custom("aria-controls","next-overflow")
                        prop.onClick(fun _ -> dispatch(OverflowToggle(not state.Overflow)));button.children "More options"]
            Mui.button [button.variant.text;button.disabled (not canMorph || state.Busy || state.Inputs.Length>=64)
                        prop.onClick(fun _ -> dispatch(AddAt state.Inputs.Length));button.children "Add face"]
            if state.Busy then Mui.button [button.variant.text;button.disabled (state.Stage="cancelling");prop.onClick(fun _ -> dispatch Cancel);button.children "Cancel"]]]
        if not canMorph then Html.p [prop.className "next-morph-reason";prop.custom("role","note");prop.text "Add a second face to create a morph — a single face still generates."]
        // C-02: a quiet caption states the route in use and names any route this device refused,
        // so a silent fallback or a failed canary never hides what the user is actually running.
        if state.Route<>"" then
            Html.p [prop.className "next-route-caption";prop.custom("data-next-route",state.Route);
                    prop.text (sprintf "Using the %s route.%s" state.Route
                                 (match state.Rejected with Some r -> sprintf " The %s route failed its device check on this device." r | None -> ""))]
        if state.Overflow then Html.div [prop.id "next-overflow";prop.children [overflow state dispatch]]
        // Status, progress and the measured time remaining live next to the action they describe.
        Html.div [prop.className "next-status";prop.custom("role","status");prop.ariaLive.polite;prop.children [
            if state.Busy then Html.progress [prop.className "next-sr";prop.max 1.;if state.Fraction>0. then prop.value state.Fraction]
            if state.Busy then progressBar (if state.Fraction>0. then state.Fraction else -1.)
            Html.span [prop.text state.Status]
            if state.Busy && perFrameText()<>"" then Html.span [prop.className "next-remaining";prop.text (perFrameText())]
            if state.Busy && state.Remaining<>"" then Html.span [prop.className "next-remaining";prop.text state.Remaining]]]
        // Slow-video warning (U-12): names the measured estimate, never blocks, dismissible.
        match state.Warn with
        | Some warning -> Html.div [prop.className "next-slow-warning box";prop.custom("role","note");prop.children [
            Html.p warning
            Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch DismissWarn);button.children "Dismiss"]]]
        | None -> ()]]

/// Classic's slider (U-14): every retained frame preloaded as an image, scrubbed onto a canvas.
[<ReactComponent>]
let private nextSlider (frames:string array) (dim:int) =
    let canvasRef = React.useRef(None)
    let (frameNum, setFrameNum) = React.useState(1 + frames.Length/2)
    let (_, reRender) = React.useState(0)
    let store = React.useRef None
    let createImage (url:string) =
        let img = HTMLImageElement.Create(float dim,float dim)
        img.onload <- fun _ -> reRender(0)
        img.src <- url
        img
    match store.current with
    | Some (images:HTMLImageElement list,count:int) when count=frames.Length ->
        match canvasRef.current with
        | Some canvas ->
            let canvas = unbox<HTMLCanvasElement> canvas
            canvas.width <- float dim
            canvas.height <- float dim
            let context = canvas.getContext_2d()
            let currentFrame = min frameNum images.Length
            let currentImage = images.[currentFrame-1]
            if currentImage.complete then context?drawImage(currentImage,0.,0.,dim,dim)
        | None -> ()
    | _ ->
        store.current <- Some (frames |> Array.map createImage |> Array.toList, frames.Length)
    Html.div [prop.className "next-slider";prop.children [
        Html.canvas [prop.ref canvasRef;prop.width dim;prop.height dim;prop.style [style.maxWidth(length.percent 100);style.height length.auto];prop.ariaLabel "Morph preview, frame by frame";prop.custom("role","img")]
        Mui.slider [slider.min 1;slider.max frames.Length;slider.value frameNum;slider.onChange setFrameNum
                    prop.ariaLabel "Morph frame";prop.className "next-slider-control"]]]

let private videoSlot (state:State) dispatch =
    let poster = state.Faces |> Array.tryHead |> Option.map(fun f -> f.url)
    let sliderChoice =
        match state.UseSlider,state.SliderFrames with
        | true,Some frames -> nextSlider frames videoDim
        | true,None -> Html.p [prop.className "next-slider-empty";prop.custom("role","note");prop.text "This morph's frames are not saved on this device yet, so the slider has nothing to scrub. Generate the morph again once frame storage is on."]
        | _ -> Html.none
    let videoChildren = [
        yield Html.video ([prop.src state.VideoUrl;prop.controls true;prop.loop true;prop.custom("playsInline",true)
                           prop.ariaLabel "Your morph";prop.className "next-video"]
                          @ (poster |> Option.map prop.poster |> Option.toList))
        yield Mui.formControlLabel [formControlLabel.control (Mui.checkbox [checkbox.checked' state.UseSlider;checkbox.onChange(UseSliderToggle >> dispatch)]);formControlLabel.label "Use Slider"]
        yield sliderChoice
        yield Html.div [prop.className "next-actions";prop.children [
            Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch(Share "video"));button.children "Share morph"]
            Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch(Save "video"));button.children "Save video"]]]
    ]
    Html.div [prop.className "next-video-slot";prop.children (if state.VideoUrl<>"" then videoChildren else [])]

// --- Page ------------------------------------------------------------------------------------

let faq (question:string) (answer:ReactElement list) =
    Html.details [prop.className "next-faq";prop.children (Html.summary question :: answer)]

let private explainSection =
    Html.section [prop.className "next-explain box";prop.custom("data-next-explain","true");prop.id "next-explain";prop.children [
        Html.h2 "What is this?"
        Html.p "Generate faces from words, seeds or photos. Add faces to build a longer loop. Share the image or video directly; export a project to keep editing."
        Html.p "Model files and full-size originals are saved on this device where storage is available. Your first generation takes longer while the models download."
        Html.h3 "How does it work?"
        Html.p [Html.text "Whatever you type is hashed and used to ";Html.a [prop.href "https://en.wikipedia.org/wiki/Random_seed";prop.text "seed"];Html.text " a random number generator, which picks a point in the latent space of ";Html.a [prop.href "https://github.com/NVlabs/stylegan2";prop.text "StyleGAN2"];Html.text ". The same text always gives the same face. A morph walks between those points and generates every frame along the way."]
        Html.p [Html.text "When you use a photo, ";Html.a [prop.href "https://github.com/omertov/encoder4editing";prop.text "encoder4editing"];Html.text " encodes it as a latent. It balances accuracy against editability, so the result will not look quite like the photo, but it morphs well."]
        Html.p "All of it runs here, on your device. Your photos and words are never uploaded."
        Html.h3 "Questions"
        faq "Are these real people?" [
            Html.p "Faces made from words or seeds are not real people. They are randomly generated."
            Html.p "A face you make from a photo is an encoding of whoever is in that photo."]
        faq "How does what I type affect the face?" [
            Html.p "It does not, beyond this: the same text always generates the same face. There is no other correlation."]
        faq "Why does a face have glasses when neither endpoint does?" [
            Html.p "Intermediate faces are usually a good mix of the endpoints, but sometimes one picks up glasses, or a frown, or goes old-young-old."
            Html.p "The model has no concept of human features. It learned to produce images that look like faces from a set of numbers, and it happens that doing so well coincides with having gradients for the features we would expect."
            Html.p "Short version: nobody really knows."]
        faq "Why is there a creepy second face?" [
            Html.p [Html.text "The training set has a small number of photos with a second face in them. Enough for the model to learn to generate one occasionally, not enough to learn to make it convincing. For an example, try ";Html.code "alice";Html.text "."]]
        faq "Why are there more women than men?" [
            Html.p [Html.text "The model was trained on the ";Html.a [prop.href "https://github.com/NVlabs/ffhq-dataset";prop.text "Flickr-Faces-HQ dataset"];Html.text ", crawled from Flickr, and it inherits that site's biases."]]
        faq "How many faces are possible?" [
            Html.p "Practically limitless."
            Html.p "Though it depends how you count. Morph between two faces and there is usually no single frame where you can say it has become a different face. Does every frame count?"
            Html.p "Technically the text is hashed with SHA-256, which puts an upper limit of 2^256 on the number of endpoints you can reach by typing."]
        faq "Can I morph a photo of a real face?" [
            Html.p "Yes. Set Face source to Photo, or drop a photo onto a face. Photos are processed on your device."]
        faq "Is there an API I can self-host?" [
            Html.p [Html.text "Yes. The server source is at ";Html.a [prop.href "https://github.com/check-face/checkface";prop.text "github.com/check-face/checkface"];Html.text " and is documented at ";Html.a [prop.href "https://checkface.facemorph.me/api";prop.text "checkface.facemorph.me/api"];Html.text "."]
            Html.p [Html.text "If you need a setup under your own control, self-hosting is the safest option. Bugs belong in a GitHub issue; for questions about the transition, email ";Html.a [prop.href "mailto:checkfaceml@gmail.com";prop.text "checkfaceml@gmail.com"];Html.text "."]]]]

/// The debug area (U-09): processing mode and reporting live here, next to each other, where a
/// tester looks for them. The mode select stays a native, keyboard-reachable element because
/// next-e2e selects the CPU route through it.
let private debugArea (state:State) dispatch =
    Html.section [prop.className "next-debug box";prop.custom("role","region");prop.ariaLabel "For testing";prop.children [
        Html.h2 "For testing"
        Html.p "Force a processing mode (for testing) — leave it on automatic unless you are comparing routes:"
        Html.select [prop.value state.Provider;prop.disabled state.Busy;prop.ariaLabel "Processing mode";prop.onChange(Provider >> dispatch)
                     prop.children(["auto","Automatic processing";"cpu","CPU";"webgpu","WebGPU";"webgl","WebGL GPU"] |> List.map(fun (key,text) -> Html.option [prop.value key;prop.text text]))]
        Html.label [prop.className "next-debug-report";prop.children [
            Mui.checkbox [checkbox.checked' state.Debug;checkbox.onChange(fun (v:bool) -> dispatch(Debug v))]
            Html.span "Send debug reports until I turn this off"]]
        Html.p [prop.custom("role","status");prop.text state.DebugStatus]
        if stagedReportCount()>0 && not state.Debug then Html.p (sprintf "%d staged report(s) from this session are ready to send if you agree." (stagedReportCount()))
        Html.p [Html.a [prop.href "mailto:checkfaceml@gmail.com";prop.text "Email us"]]
    ]]

let view state dispatch = App.ThemedApp [
    Mui.cssBaseline []
    Html.main [prop.className "facemorph-page next-product"
               prop.onDragOver(fun (e:Browser.Types.DragEvent) -> e.preventDefault(); if not state.Busy then e.dataTransfer?dropEffect <- "copy")
               prop.onDrop(fun (e:Browser.Types.DragEvent) ->
                   e.preventDefault()
                   // A drop on the page background fills the first empty face; if none are empty,
                   // it appends. Multiple files create one face per file, in drop order.
                   if not state.Busy then dispatch(Photos(None,photoFiles e)))
               prop.children [
        App.header
        // Shown only to someone who opened the testing link, and only until they answer.
        if state.Invite && not state.Debug then
            Html.section [prop.className "next-invite box";prop.custom("role","region");prop.ariaLabel "Help us with this test";prop.children [
                Html.h2 "Thanks for testing FaceMorph"
                Html.p "If anything is slow, wrong or broken, a debug report tells us what happened without you having to describe it."
                Html.p "Reports contain a random device ID, app and browser versions, processing stages, timings and safe error codes. They never contain your photos, the words you type, the faces you make, or anything identifying you. They go to our private diagnostics service and are deleted after 30 days."
                Html.div [prop.className "next-actions";prop.children [
                    Mui.button [button.variant.contained;prop.onClick(fun _ -> dispatch(Debug true));button.children "Turn on debug reporting"]
                    Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch DismissInvite);button.children "Not now"]]]
                Html.p [prop.className "next-invite-note";prop.text "You can turn it off at any time in the testing area below. Generating works exactly the same either way."]]]
        Html.div [prop.className "next-faces-area";prop.custom("data-next-faces",state.Inputs.Length);prop.children [
            match state.Inputs with
            | [first;second] ->
                // N=2 is the common case: classic's exact grid at ≥1000px (D-05), the vertical
                // stack everywhere else (D-03), MORPH centred between the two faces.
                Html.div [prop.className "next-morph-content n2";prop.children [
                    Html.div [prop.className "next-morph-cell next-morph-from";prop.children [viewFace state dispatch 0 first "Morph from"]]
                    Html.div [prop.className "next-morph-cell next-morph-morph";prop.children [morphSlot state dispatch]]
                    Html.div [prop.className "next-morph-cell next-morph-to";prop.children [viewFace state dispatch 1 second "Morph to"]]
                    Html.div [prop.className "next-morph-cell next-morph-vid";prop.children [videoSlot state dispatch]]
                    Html.div [prop.className "next-connector next-connector-stack";prop.children [
                        Mui.iconButton [prop.className "next-connector-add";prop.ariaLabel "Add a face between these two";prop.disabled state.Busy
                                        prop.onClick(fun _ -> dispatch(AddAt 1));iconButton.children (addIcon [])]]]]]
            | inputs ->
                Html.div [prop.className "next-morph-content n3";prop.children [
                    Html.div [prop.className "next-faces-row";prop.custom("data-next-face-count",inputs.Length);prop.children (tilesWithConnectors state dispatch)]
                    morphSlot state dispatch
                    videoSlot state dispatch]]]]
        match estimate state with
        | Some(perFace,frames) when not state.Busy ->
            let perFrame = perFrameText()
            Html.p [prop.className "next-estimate";prop.custom("role","note")
                    prop.text (if frames>0. then sprintf "On this device a face took %s%s, so a %g-frame morph should take %s." (describeMs perFace) (if perFrame="" then "" else " (" + perFrame + ")") frames (describeMs (perFace*frames))
                              else sprintf "On this device a face took %s." (describeMs perFace))]
        | _ -> Html.none
        // Guidance follows evidence, not the route's name: a qualified GPU route can still be slow
        // on a given machine, and this device has already shown what a face costs it.
        if isSlowDevice state then
            Html.div [prop.className "next-slow-route box";prop.custom("role","note");prop.children [
                Html.p [Html.strong "Generating is slow on this device.";Html.text (if state.Route="cpu" then " No graphics acceleration qualified here, so it is running on the processor." else sprintf " It qualified the %s route, but this machine is still taking a long time per face." state.Route)]
                Html.p "It will still finish, and everything is saved as it goes. A laptop or desktop with a graphics card — or the desktop app — is dramatically quicker for morphs."
                Html.p [Html.a [prop.href "https://github.com/check-face/facemorph.me/releases";prop.text "Desktop builds"]]]]
        match state.Error with
        | Some message -> Html.div [prop.className "next-error box";prop.custom("role","alert");prop.children [
            Html.p message
            // R2-15: the failure and the staged report must be tieable by a human. The
            // reference is empty without consent, in which case the line simply doesn't show.
            let reference=reportReference()
            if reference<>"" then Html.p [prop.className "next-error-reference";prop.custom("role","note");prop.text (sprintf "Report reference: %s" reference)]
            Html.div [prop.className "next-actions";prop.children [
                // What led up to this failure is already on the device. Offer to send it now,
                // even from someone who had not opted in before it happened.
                if not state.Debug && stagedReportCount()>0 then
                    Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch(Debug true));button.children "Send debug report"]
                Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch DismissError);button.children "Dismiss"]]]]]
        | None -> ()
        // Out of the primary action row: it protects a session, it is not a way to share.
        Html.div [prop.className "next-actions next-project";prop.children [
            Mui.button [button.variant.text;prop.disabled (state.Busy || state.Faces.Length<2);prop.onClick(fun _ -> dispatch Export);button.children "Export project"]
            Html.label [prop.className "next-project-open";prop.children [
                Html.span "Open project"
                Html.input [prop.className "next-file-input";prop.type'.file;prop.accept ".json,.facemorph";prop.disabled state.Busy;prop.ariaLabel "Open project";prop.onChange(fun (e:Browser.Types.Event) -> dispatch(Import(firstFile e)))]]]]]
        // The explainer and FAQ are the page body (U-13): present in the DOM on load, below the
        // fold, without toggling anything.
        explainSection
        debugArea state dispatch
        match state.Crop with
        | Some crop ->
            let placed=cropFrame crop.view 320.
            Html.div [prop.className "next-crop-dialog";prop.custom("role","dialog");prop.custom("aria-modal",true);prop.ariaLabel "Crop photo"
                      prop.onKeyDown(fun (e:Browser.Types.KeyboardEvent) -> if e.key="Escape" then (e.preventDefault(); dispatch CropCancel))
                      prop.children [
                Html.div [prop.className "next-crop-panel box";prop.children [
                    Html.div [prop.className "next-topline";prop.children [Html.h2 "Crop your photo";Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch CropCancel);button.children "Cancel crop"]]]
                    Html.p "Drag to move, or use the arrow keys. Zoom to fill the square. Only this square is processed."
                    Html.div [prop.className "next-crop-view";prop.ariaLabel "Crop area";prop.custom("role","application");prop.tabIndex 0
                              // The square can be moved and sized without a pointer.
                              prop.onKeyDown(fun (e:Browser.Types.KeyboardEvent) ->
                                let step=if e.shiftKey then 320. else 40. // screen px: one viewport, or an eighth
                                match e.key with
                                | "ArrowLeft" -> e.preventDefault(); dispatch(CropPan(step,0.))
                                | "ArrowRight" -> e.preventDefault(); dispatch(CropPan(-step,0.))
                                | "ArrowUp" -> e.preventDefault(); dispatch(CropPan(0.,step))
                                | "ArrowDown" -> e.preventDefault(); dispatch(CropPan(0.,-step))
                                | "+" | "=" -> e.preventDefault(); dispatch(CropZoom((crop.view?zoom: float)+0.25))
                                | "-" | "_" -> e.preventDefault(); dispatch(CropZoom((crop.view?zoom: float)-0.25))
                                | "Escape" -> e.preventDefault(); dispatch CropCancel
                                | _ -> ())
                              prop.onPointerDown(fun (e:Browser.Types.PointerEvent) -> dragStart <- Some(e.clientX,e.clientY); e.currentTarget?setPointerCapture(e.pointerId))
                              prop.onPointerMove(fun (e:Browser.Types.PointerEvent) ->
                                match dragStart with
                                | Some(x,y) -> dragStart <- Some(e.clientX,e.clientY); dispatch(CropPan(e.clientX-x,e.clientY-y))
                                | None -> ())
                              prop.onPointerUp(fun _ -> dragStart <- None)
                              prop.onPointerCancel(fun _ -> dragStart <- None)
                              prop.children [
                                Html.img [prop.src crop.url;prop.alt "Photo being cropped";prop.className "next-crop-image"
                                          prop.style [style.width (length.px (placed?width: float));style.height (length.px (placed?height: float));style.left (length.px (placed?x: float));style.top (length.px (placed?y: float));style.custom("transform", sprintf "rotate(%gdeg)" (placed?rotation: float))]]]]
                    Html.label [prop.className "next-crop-zoom";prop.children [
                        Html.span "Zoom"
                        Html.input [prop.type'.range;prop.min 1;prop.max 8;prop.step 0.1;prop.ariaLabel "Zoom";prop.value (crop.view?zoom: float);prop.onChange(fun (v:float) -> dispatch(CropZoom v))]]]
                    Html.div [prop.className "next-actions";prop.children [
                        Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch CropRotate);button.children "Rotate"]
                        Mui.button [button.variant.contained;prop.onClick(fun _ -> dispatch CropAccept);button.children "Use this crop"]]]]]]]
        | None -> Html.none
        if state.Browse.IsSome then Html.div [prop.className "next-name-dialog";prop.custom("role","dialog");prop.custom("aria-modal",true);prop.onKeyDown(fun e -> namesKey e (fun () -> dispatch CloseNames));prop.ariaLabel "Browse names";prop.children [
            Html.div [prop.className "next-name-panel box";prop.children [
                Html.div [prop.className "next-topline";prop.children [Html.h2 "Browse names";Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch CloseNames);button.children "Close"]]]
                Html.input [prop.className "next-text-input";prop.ariaLabel "Search names";prop.placeholder "Search names";prop.value state.NameQuery;prop.onChange(fun (v:string) -> dispatch(SearchNames v))]
                Html.div [prop.className "next-name-grid";prop.children [
                    for name in state.Names |> Array.filter(fun x -> x.name.ToLowerInvariant().Contains(state.NameQuery.ToLowerInvariant())) |> Array.truncate state.NameLimit do
                        Mui.button [prop.key name.value;prop.className "next-name-choice";prop.onClick(fun _ -> dispatch(ChooseName name.value));button.children [
                            Html.img [prop.src name.image;prop.alt "";prop.custom("loading","lazy");prop.width 200;prop.height 200];Html.span name.name]]]]
                Mui.button [button.variant.text;prop.onClick(fun _ -> dispatch MoreNames);button.children "Show more"]
            ]]]]
        Html.footer [prop.className "next-footer";prop.children [Html.a [prop.href "mailto:checkfaceml@gmail.com";prop.text "checkfaceml@gmail.com"]]]
    ]]
]
