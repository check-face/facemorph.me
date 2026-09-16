module NextProduct

open Elmish
open Fable.Core
open Fable.Core.JsInterop
open Feliz
open Feliz.MaterialUI

[<CLIMutable>]
type Input = { id: string; mode: string; value: string; file: obj }
[<CLIMutable>]
type Face = { id: string; url: string; label: string }
[<CLIMutable>]
type NameFace = { name:string; value:string; image:string }
[<CLIMutable>]
type Progress = { jobId: int; stage: string; text: string; fraction: float }
[<CLIMutable>]
type Output = { faces: Face array; videoUrl: string; projectJson: string; message: string; errorMessage: string; restored: bool; inputs: Input array; kind: string; width: float; pinch: bool; frames: int; fps: int }
[<CLIMutable>]
type Request = { jobId: int; action: string; inputs: Input array; kind: string; width: float; pinch: bool; frames: int; fps: int; provider: string }

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
[<Import("setDebug", "./product-bridge.mjs")>]
let setDebug (enabled: bool): unit = jsNative
[<Emit("$0.target.files && $0.target.files[0]")>]
let firstFile (event: obj): obj = jsNative
[<Emit("$0 ? $0.name : ''")>]
let fileName (file: obj): string = jsNative

[<Import("previewPhoto", "./photo/crop.mjs")>]
let previewPhoto (file: obj) (options: obj): JS.Promise<obj> = jsNative
[<Emit("Object.assign({crop:true,file:$1},$0)")>]
let cropOffer (preview: obj) (file: obj): obj = jsNative
[<Import("cropPhoto", "./photo/crop.mjs")>]
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
[<Import("selectPhoto", "./photo-selection.mjs")>]
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
    Browse: string option; Names: NameFace array; NameQuery: string; NameLimit: int; Error: string option; DebugStatus: string; Help: bool; Debug: bool; NextId: int
    Crop: CropChoice option
}
and [<CLIMutable>] CropChoice = { faceId: string; url: string; file: obj; scale: float; view: obj }
type Msg =
    | Edit of string * string | Mode of string * string | Photo of string * obj
    | PickPhoto of string * obj | PhotoError of string
    | Add | Remove of string | Kind of string | Width of float | Pinch of bool
    | Frames of int | Provider of string | Run of string | Cancel
    | Progressed of Progress | Completed of int * Output | Failed of int * string
    | Save of string | Share of string | Export | Import of obj | Notice of string
    | Help | Debug of bool | DismissError
    | BrowseNames of string | NamesLoaded of NameFace array | SearchNames of string | ChooseName of string | CloseNames | MoreNames
    | CropPan of float * float | CropZoom of float | CropRotate | CropAccept | CropCancel | RequestCrop of string | Cropped of string * obj

[<Emit("window.location.pathname === '/names' || window.location.pathname === '/names/' || new URLSearchParams(window.location.search).has('names')")>]
let namesRequested (): bool = jsNative

let emptyFile: obj = null
let init () =
    { Inputs = [{id="face-1";mode="text";value="hello";file=emptyFile}; {id="face-2";mode="seed";value="389";file=emptyFile}]
      Faces=[||];VideoUrl="";Kind="pairwise-figure8";Width=0.2;Pinch=false;Frames=16;Fps=16;Provider="auto"
      Busy=false;JobId=0;Stage="idle";Status="";Fraction=0.;Browse=None;Names=[||];NameQuery="";NameLimit=48;Error=None;DebugStatus="";Help=false;Debug=false;NextId=3;Crop=None },
    Cmd.batch [Cmd.ofSub(fun dispatch -> subscribe (Progressed >> dispatch)); if namesRequested() then Cmd.ofMsg(BrowseNames "face-1")]

let update msg state =
    let change id f = {state with Inputs=state.Inputs |> List.map(fun item -> if item.id=id then f item else item); VideoUrl="";Status=""}
    let noticeTask fn arg = Cmd.OfPromise.either fn arg Notice (fun _ -> Notice "Couldn't save or share this file. Try Save instead.")
    match msg with
    | Edit(id,value) when not state.Busy -> invalidatePhotoSelections(); change id (fun item -> {item with value=value}), Cmd.none
    | Mode(id,mode) when not state.Busy -> invalidatePhotoSelections(); change id (fun item -> {item with mode=mode;file=emptyFile}), Cmd.none
    | PickPhoto(id,files) when not state.Busy -> state,Cmd.OfPromise.either selectPhoto (createObj ["id" ==> id;"files" ==> files]) (fun file -> Photo(id,file)) (fun e -> PhotoError e.Message)
    | Cropped(id,file) when not (isNull file) ->
        {change id (fun item -> {item with mode="photo";file=file;value=fileName file}) with Busy=false;Stage="idle";Status="";Fraction=0.;Error=None},Cmd.none
    | PhotoError message when not state.Busy || state.Stage="cropping" ->
        {state with Error=Some message;Busy=false;Stage=(if state.Stage="cropping" then "idle" else state.Stage);Status=""},Cmd.none
    // A photo the alignment route cannot take whole opens the crop step first; only the crop
    // is ever aligned. Cancelling leaves the existing face and its inputs alone.
    | Photo(id,offer) when not state.Busy && not (isNull offer) && isCropOffer offer ->
        state.Crop |> Option.iter (fun previous -> revokeUrl previous.url)
        focusCropArea()
        {state with Error=None;Crop=Some {faceId=id;url=offer?url;file=offer?file;scale=offer?scale
                                          view=createCrop(createObj ["previewWidth" ==> offer?previewWidth;"previewHeight" ==> offer?previewHeight;"scale" ==> offer?scale])}},Cmd.none
    | RequestCrop id when not state.Busy ->
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
        state.Crop |> Option.iter (fun crop -> revokeUrl crop.url)
        {state with Crop=None},Cmd.none
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
    | Photo(id,file) when not state.Busy && not (isNull file) -> {change id (fun item -> {item with mode="photo";file=file;value=fileName file}) with Error=None;Status=""}, Cmd.none
    | Add when not state.Busy && state.Inputs.Length<64 ->
        {state with Inputs=state.Inputs @ [{id="face-"+System.Guid.NewGuid().ToString("N");mode="text";value="";file=emptyFile}];NextId=state.NextId+1;VideoUrl=""},Cmd.none
    | Remove id when not state.Busy && state.Inputs.Length>2 -> invalidatePhotoSelections(); {state with Inputs=state.Inputs |> List.filter(fun x -> x.id<>id);VideoUrl=""},Cmd.none
    | Kind value when not state.Busy -> {state with Kind=value;VideoUrl=""},Cmd.none
    | Width value when not state.Busy -> {state with Width=value;VideoUrl=""},Cmd.none
    | Pinch value when not state.Busy -> {state with Pinch=value;VideoUrl=""},Cmd.none
    | Frames value when not state.Busy -> {state with Frames=value;VideoUrl=""},Cmd.none
    | Provider value when not state.Busy -> {state with Provider=value},Cmd.none
    | Run action when not state.Busy ->
        invalidatePhotoSelections()
        let id=state.JobId+1
        let request={jobId=id;action=action;inputs=Array.ofList state.Inputs;kind=state.Kind;width=state.Width;pinch=state.Pinch;frames=state.Frames;fps=state.Fps;provider=state.Provider}
        {state with Busy=true;JobId=id;Error=None;Stage="preparing";Status="Preparing…";Fraction=0.},
        Cmd.OfPromise.either execute request (fun result -> Completed(id,result)) (fun e -> Failed(id,e.Message))
    | Progressed progress when progress.stage.StartsWith("diagnostics-") ->
        let status = match progress.stage with
                     | "diagnostics-sent" -> "Report saved. Reference: " + progress.text
                     | "diagnostics-failed" -> "Report could not be saved. You can still email us."
                     | "diagnostics-enabled" -> "Reporting is on. It stays on until you turn it off."
                     | _ -> "Reporting is off."
        {state with DebugStatus=status;Debug=(match progress.stage with | "diagnostics-enabled" -> true | "diagnostics-disabled" -> false | _ -> state.Debug)},Cmd.none
    | Progressed progress when state.Busy && progress.jobId=state.JobId ->
        {state with Stage=progress.stage;Status=progress.text;Fraction=progress.fraction},Cmd.none
    | Completed(id,result) when id=state.JobId ->
        {state with Inputs=(if result.restored then List.ofArray result.inputs else state.Inputs);Kind=(if result.restored then result.kind else state.Kind);Width=(if result.restored then result.width else state.Width);Pinch=(if result.restored then result.pinch else state.Pinch);Frames=(if result.restored then result.frames else state.Frames);Fps=(if result.restored then result.fps else state.Fps);Busy=false;Faces=result.faces;VideoUrl=result.videoUrl;Status=result.message;Error=(if result.errorMessage="" then None else Some result.errorMessage);Stage=(if result.errorMessage="" then "done" else "error");Fraction=(if result.errorMessage="" then 1. else 0.)},Cmd.none
    | Failed(id,message) when id=state.JobId ->
        {state with Busy=false;Error=Some message;Status="";Stage="error";Fraction=0.},Cmd.none
    | Cancel when state.Busy -> cancelWork(); {state with Stage="cancelling";Status="Cancelling…"},Cmd.none
    | Save id -> state,noticeTask saveMedia id
    | Share id -> state,noticeTask shareMedia id
    | Export when not state.Busy ->
        let options=createObj ["inputs" ==> Array.ofList state.Inputs;"kind" ==> state.Kind;"width" ==> state.Width;"pinch" ==> state.Pinch;"frames" ==> state.Frames;"fps" ==> state.Fps]
        state,Cmd.OfPromise.either exportProject options Notice (fun e -> Notice e.Message)
    | Import file when not state.Busy && not (isNull file) ->
        invalidatePhotoSelections()
        let id=state.JobId+1
        {state with Busy=true;JobId=id;Stage="importing";Status="Opening project…"},
        Cmd.OfPromise.either importProject (createObj ["file" ==> file; "jobId" ==> id; "provider" ==> state.Provider]) (fun result -> Completed(id,result)) (fun e -> Failed(id,e.Message))
    | Notice text -> {state with Status=text},Cmd.none
    | Help -> {state with Help=not state.Help},Cmd.none
    | Debug enabled -> setDebug enabled;{state with Debug=enabled},Cmd.none
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
let faq (question:string) (answer:ReactElement list) =
    Html.details [prop.className "next-faq";prop.children (Html.summary question :: answer)]
let button (label:string) (disabled:bool) (action:unit -> unit) = Html.button [prop.className "button";prop.disabled disabled;prop.type'.button;prop.onClick(fun _ -> action());prop.text label]
let select (value:string) (label:string) (disabled:bool) (options:(string*string) list) (action:string -> unit) = Html.div [
    prop.className "select";prop.children [Html.select [prop.value value;prop.disabled disabled;prop.ariaLabel label;prop.onChange action;
        prop.children(options |> List.map(fun (key,text) -> Html.option [prop.value key;prop.text text]))]]]
let viewFace (state:State) dispatch (item:Input) =
    let face = state.Faces |> Array.tryFind(fun f -> f.id=item.id)
    Html.section [prop.key item.id;prop.className "next-face box";
        prop.onDragOver(fun e -> dragPhoto e state.Busy false);
        prop.onDragLeave(fun e -> dragPhoto e state.Busy true);
        prop.onDrop(fun e -> dragPhoto e state.Busy true; if not state.Busy then dispatch(PickPhoto(item.id,photoFiles e)));
        prop.children [
            Html.input [prop.id ("photo-"+item.id);prop.type'.file;prop.hidden true;prop.accept "image/*";prop.disabled state.Busy;prop.ariaLabel "Choose photo";prop.onChange(fun (e:Browser.Types.Event) -> dispatch(PickPhoto(item.id,photoFiles e))) ]
            Html.div [prop.className "next-face-image";prop.children [
                match face with
                | Some f -> Html.img [prop.src f.url;prop.alt "Generated face";prop.width 1024;prop.height 1024]
                | None -> Html.button [prop.type'.button;prop.className "next-face-placeholder";prop.disabled state.Busy;prop.ariaLabel "Choose photo";prop.onClick(fun _ -> openPhotoPicker item.id);prop.text "+"]]]
            select item.mode "Face source" state.Busy ((if item.mode="project" then ["project","Saved project face"] else []) @ ["text","Name or words";"seed","Seed";"photo","Photo"]) (fun mode -> dispatch(Mode(item.id,mode)))
            if item.mode="photo" then
                Html.div [prop.className "next-file";prop.children [
                    Html.span item.value
                    button "Choose a photo" state.Busy (fun () -> openPhotoPicker item.id)
                    if not (isNull item.file) then button "Crop photo" state.Busy (fun () -> dispatch(RequestCrop item.id))]]
            elif item.mode="project" then Html.p "Restored from your saved project. Choose another source to replace this face."
            else Html.input [prop.className "input";prop.ariaLabel(if item.mode="seed" then "Numeric seed" else "Name or words");prop.value item.value;prop.disabled state.Busy;prop.onChange(fun (v:string) -> dispatch(Edit(item.id,v)))]
            Html.div [prop.className "next-actions";prop.children [
                button "Browse names" state.Busy (fun () -> dispatch(BrowseNames item.id))
                if face.IsSome then
                    button "Share image" state.Busy (fun () -> dispatch(Share item.id))
                    button "Save image" state.Busy (fun () -> dispatch(Save item.id))
                if state.Inputs.Length>2 then button "Remove" state.Busy (fun () -> dispatch(Remove item.id))]]]]

let view state dispatch = App.ThemedApp [
    Mui.cssBaseline []
    Html.main [prop.className "facemorph-page next-product";prop.children [
        App.header
        Html.div [prop.className "next-topline";prop.children [Html.span "FaceMorph Preview";button "Help ⓘ" false (fun () -> dispatch Help)]]
        Html.div [prop.className "next-faces";prop.children(state.Inputs |> List.map(viewFace state dispatch))]
        Html.div [prop.className "next-actions next-controls";prop.children [
            button "Add face" (state.Busy || state.Inputs.Length>=64) (fun () -> dispatch Add)
            select state.Kind "Morph pattern" state.Busy ["pairwise-figure8","Figure eight";"pairwise-ellipse","Ellipse";"full-smooth-figure8","Smooth figure eight";"full-smooth-ellipse","Smooth ellipse";"linear","Classic linear"] (Kind >> dispatch)]]
        Html.details [prop.className "next-advanced";prop.children [Html.summary "Advanced";Html.div [prop.className "next-advanced-fields";prop.children [
            Html.label [prop.children [Html.span "Width";Html.input [prop.type'.range;prop.min 0;prop.max 1.2;prop.step 0.05;prop.value state.Width;prop.disabled state.Busy;prop.onChange(fun (v:float) -> dispatch(Width v))]]]
            Html.label [prop.children [Html.input [prop.type'.checkbox;prop.isChecked state.Pinch;prop.disabled state.Busy;prop.onChange(fun (v:bool) -> dispatch(Pinch v))];Html.span " Pinch centre"]]
            select (string state.Frames) "Frames per segment" state.Busy ["16","16 frames / segment";"32","32 frames / segment";"64","64 frames / segment"] (fun v -> dispatch(Frames(int v)))
            select state.Provider "Processing mode" state.Busy ["auto","Automatic processing";"cpu","CPU";"webgpu","WebGPU";"webgl","WebGL GPU"] (Provider >> dispatch)]]]]
        Html.div [prop.className "next-actions next-generate";prop.children [
            Html.button [prop.className "button is-primary";prop.disabled state.Busy;prop.onClick(fun _ -> dispatch(Run "faces"));prop.text "Generate faces"]
            Html.button [prop.className "button is-primary";prop.disabled state.Busy;prop.onClick(fun _ -> dispatch(Run "morph"));prop.text "Create morph"]
            if state.Busy then button "Cancel" (state.Stage="cancelling") (fun () -> dispatch Cancel)]]
        Html.div [prop.className "next-status";prop.custom("role","status");prop.ariaLive.polite;prop.children [
            if state.Busy then Html.progress [prop.className "progress is-small";prop.max 1.;if state.Fraction>0. then prop.value state.Fraction]
            Html.span [prop.text state.Status]]]
        match state.Error with
        | Some message -> Html.div [prop.className "notification is-warning next-error";prop.custom("role","alert");prop.children [
            Html.p message
            Html.div [prop.className "next-actions";prop.children [button "Debug options" false (fun () -> dispatch Help);button "Dismiss" false (fun () -> dispatch DismissError)]]]]
        | None -> ()
        if state.VideoUrl<>"" then Html.section [prop.className "next-result";prop.children [
            Html.video [prop.src state.VideoUrl;prop.controls true;prop.loop true;prop.custom("playsInline",true);prop.ariaLabel "Your morph"]
            Html.div [prop.className "next-actions";prop.children [button "Share morph" false (fun () -> dispatch(Share "video"));button "Save video" false (fun () -> dispatch(Save "video"))]]]]
        Html.div [prop.className "next-actions next-project";prop.children [
            button "Export project" (state.Busy || state.Faces.Length=0) (fun () -> dispatch Export)
            Html.label [prop.className "button";prop.children [Html.span "Open project";Html.input [prop.className "next-file-input";prop.type'.file;prop.accept ".json,.facemorph";prop.disabled state.Busy;prop.ariaLabel "Open project";prop.onChange(fun (e:Browser.Types.Event) -> dispatch(Import(firstFile e)))]]]]]
        if state.Help then Html.section [prop.className "box next-help";prop.children [
            Html.h2 "Your faces, on your device"
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
                Html.p [Html.text "If you need a setup under your own control, self-hosting is the safest option. Bugs belong in a GitHub issue; for questions about the transition, email ";Html.a [prop.href "mailto:checkfaceml@gmail.com";prop.text "checkfaceml@gmail.com"];Html.text "."]]
            Html.h3 "Debug reporting"
            Html.p "Optional reports help us investigate. They contain a random device ID, app/browser versions, processing stages, timings and safe error codes—not your photos, words, images or latents. Reports go to our private diagnostics service and expire after 30 days."
            Html.label [prop.children [Html.input [prop.type'.checkbox;prop.isChecked state.Debug;prop.onChange(fun (v:bool) -> dispatch(Debug v))];Html.span " Send debug reports until I turn this off"]]
            Html.p [prop.custom("role","status");prop.text state.DebugStatus]
            Html.p [Html.a [prop.href "mailto:checkfaceml@gmail.com";prop.text "Email us"]]
            Html.p [Html.a [prop.href "https://facemorph.me";prop.text "Classic FaceMorph"]]
        ]]
        match state.Crop with
        | Some crop ->
            let placed=cropFrame crop.view 320.
            Html.div [prop.className "next-crop-dialog";prop.custom("role","dialog");prop.custom("aria-modal",true);prop.ariaLabel "Crop photo"
                      prop.onKeyDown(fun (e:Browser.Types.KeyboardEvent) -> if e.key="Escape" then (e.preventDefault(); dispatch CropCancel))
                      prop.children [
                Html.div [prop.className "next-crop-panel box";prop.children [
                    Html.div [prop.className "next-topline";prop.children [Html.h2 "Crop your photo";button "Cancel crop" false (fun () -> dispatch CropCancel)]]
                    Html.p "Drag to move, or use the arrow keys. Zoom to fill the square. Only this square is processed."
                    Html.div [prop.className "next-crop-view";prop.ariaLabel "Crop area";prop.custom("role","application");prop.tabIndex 0
                              // The square can be moved and sized without a pointer.
                              prop.onKeyDown(fun (e:Browser.Types.KeyboardEvent) ->
                                let step=if e.shiftKey then 40. else 10.
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
                        button "Rotate" false (fun () -> dispatch CropRotate)
                        button "Use this crop" false (fun () -> dispatch CropAccept)]]]]]]
        | None -> Html.none
        if state.Browse.IsSome then Html.div [prop.className "next-name-dialog";prop.custom("role","dialog");prop.custom("aria-modal",true);prop.onKeyDown(fun e -> namesKey e (fun () -> dispatch CloseNames));prop.ariaLabel "Browse names";prop.children [
            Html.div [prop.className "next-name-panel box";prop.children [
                Html.div [prop.className "next-topline";prop.children [Html.h2 "Browse names";button "Close" false (fun () -> dispatch CloseNames)]]
                Html.input [prop.className "input";prop.ariaLabel "Search names";prop.placeholder "Search names";prop.value state.NameQuery;prop.onChange(fun (v:string) -> dispatch(SearchNames v))]
                Html.div [prop.className "next-name-grid";prop.children [
                    for name in state.Names |> Array.filter(fun x -> x.name.ToLowerInvariant().Contains(state.NameQuery.ToLowerInvariant())) |> Array.truncate state.NameLimit do
                        Html.button [prop.key name.value;prop.className "next-name-choice";prop.onClick(fun _ -> dispatch(ChooseName name.value));prop.children [Html.img [prop.src name.image;prop.alt "";prop.custom("loading","lazy");prop.width 200;prop.height 200];Html.span name.name]]]]
                button "Show more" false (fun () -> dispatch MoreNames)
            ]]]]
        Html.footer [prop.className "next-footer";prop.children [Html.a [prop.href "mailto:checkfaceml@gmail.com";prop.text "checkfaceml@gmail.com"]]]
    ]]
]
