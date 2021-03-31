module SliderMorph

open Feliz.MaterialUI
open Feliz
open Fable.Core.JsInterop
open Fable.Core
open Browser
open Browser.Types
open Fable.React.Helpers

open Checkface

type Props = {
    Values : CheckfaceSrc * CheckfaceSrc
    OnLoaded : unit -> unit
    FrameSrc : CheckfaceSrc * CheckfaceSrc -> int -> int -> int -> string
    Dim : int
    NumFrames : int
}

[<ReactComponent>]
let ViewSliderMorph (props : Props) =
        let canvasRef = React.useRef(None)
        let frames = React.useRef(None)
        let frameNum, setFrameNum = React.useState((* center *) 1 + props.NumFrames / 2) // using local state for frameNum for performance
        let _, reRender = React.useState(0) //state not used, just a way of getting react to force update when images load

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
                    else
                        img.onload <- (fun _ -> reRender(n))
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