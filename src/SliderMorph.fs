module SliderMorph

open Feliz.MaterialUI
open Feliz
open Fable.Core.JsInterop
open Fable.Core
open Browser
open Browser.Types
open Fable.React.Helpers

// workaround till proper fix for https://github.com/fable-compiler/fable-browser/issues/25
type [<AllowNullLiteral>] ImageType =
    [<Emit("new Image($1...)")>] abstract Create: ?width: float * ?height: float -> HTMLImageElement

let [<Global>] HTMLImageElement : ImageType = jsNative

type Props = {
    Values : string * string
    OnLoaded : unit -> unit
    FrameSrc : string * string -> int -> int -> int -> string
    Dim : int
    NumFrames : int
}

let sliderMorph = React.functionComponent ("canvas-face", fun (props : Props) ->
        let canvasRef = React.useRef(None)
        let frames = React.useRef(None)
        let frameNum, setFrameNum = React.useState((* center *) 1 + props.NumFrames / 2) // using local state for frameNum for performance

        match frames.current with
        | Some (frames:HTMLImageElement list,lastProps) when equalsButFunctions lastProps props ->
            match canvasRef.current with
            | None ->
                console.log("Did nothing :(")
                ()
            | Some canvas ->
                let canvas = unbox<HTMLCanvasElement> canvas
                canvas.height <- float props.Dim
                canvas.width <- float props.Dim
                let context = canvas.getContext_2d ()
                let currentFrame = min frameNum frames.Length // incase numframes decreases without moving slider
                let currentImage = frames.[currentFrame - 1]
                if currentImage.complete then
                    context?drawImage(currentImage, 0., 0.)
        | _ ->
            console.log("Making image frames")
            frames.current <-
                let createImg n =
                    let img = HTMLImageElement.Create (float props.Dim, float props.Dim)
                    if n = frameNum then
                        img.onload <- (ignore >> props.OnLoaded)
                    img.src <- props.FrameSrc props.Values props.Dim props.NumFrames (n-1)
                    img
                let frames =
                    [1..props.NumFrames]
                    |> List.map createImg
                Some (frames, props)
                
        Html.div [
            prop.style [
                // style.width dim
                style.display.block
                style.margin.auto
            ]
            prop.children [
                Html.canvas [
                    prop.ref canvasRef
                    prop.style [
                        style.maxWidth (length.percent 100)
                        style.height length.auto
                        style.display.block
                        style.margin.auto
                    ]
                    prop.width props.Dim
                    prop.height props.Dim
                ]
                Mui.slider [
                    prop.style [
                        style.display.block
                        style.maxWidth (length.px props.Dim)
                        style.margin.auto
                    ]
                    slider.min 1
                    slider.max props.NumFrames
                    slider.onChange setFrameNum
                    slider.value frameNum
                ]
            ]
        ]
    )