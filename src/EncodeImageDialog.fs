module EncodeImageDialog
open Feliz
open Fable.MaterialUI.Icons
open Feliz.MaterialUI
open Fulma
open Browser.Types
open Browser
open Fable.Core.JsInterop
open Fetch
open Logos
open Checkface
open Config
open Feliz.MaterialUI.themeStatic.theme
type EncodeImageDialogProps = {
    OnClose : unit -> unit
    IsOpen : bool
    RenderImgGuid : System.Guid -> ReactElement
    EncodeImageApiLocation : string
    OnImageEncoded : System.Guid -> unit
}

type Loadable<'a> =
    | NotLoading
    | Loading
    | Loaded of 'a
    | LoadingError

type FormDataImg = Blob of Blob | File of File

let errorIcon () =
    Mui.icon [
        icon.children (errorIcon [ ])
        icon.color.error
    ]

let centerInGrid (elements : ReactElement list) =
    Mui.grid [
        grid.alignItems.center
        grid.justify.center
        grid.container true
        prop.style [ style.height (length.percent 100) ]
        prop.children [
            Mui.grid [
                grid.item true
                grid.children elements
            ]
        ]
    ]

let isInvalidImageDataUrl (dataUrl:string) =
    // must be image mime type but not svg
    (not (dataUrl.StartsWith "data:image")) || dataUrl.StartsWith("data:image/svg")

module Cropper =
    type RotateOptions = {
        immediately: bool
        transitions: bool
        normalize: bool
    }
    type CropperComponent =
        abstract rotateImage : int -> RotateOptions -> unit
        abstract getCanvas : unit -> HTMLCanvasElement

    type Lines() = class end
    type Handlers() = class end

    type StencilProps = {
        aspectRatio: float
        overlayClassName: string
    }

    let inline cropper props = createElement (import "Cropper" "react-advanced-cropper") props

open Cropper

[<ReactComponent>]
let EncodeImageDialog props =
        let fileInput = React.useRef None
        let chosenFileDataUrl, setChosenFileDataUrl = React.useState (NotLoading)
        let encodedImageResult, setEncodeResult = React.useState (NotLoading)
        let pasteHereValue, setPasteHereValue = React.useState ("")
        let isCropping, setIsCropping = React.useState false
        let cropperRotSlider, setCropperRotSlider = React.useState 0
        let cropperComponent = React.useRef None
        let croppedImageBlob, setCroppedImageBlob = React.useState None

        let getDataUrl (input:Types.HTMLInputElement) =
            setEncodeResult NotLoading
            setCroppedImageBlob None
            if input.files.length < 1 then
                setChosenFileDataUrl NotLoading
            else
                setChosenFileDataUrl Loading
                let file = input.files.[0]
                let reader = FileReader.Create ()
                reader.onload <- fun e -> setChosenFileDataUrl (Loaded e.target?result)
                reader.onerror <- fun e -> setChosenFileDataUrl LoadingError
                printfn "readAsDataUrl"
                reader.readAsDataURL(file)

        let onFileInputChange (e: Event) =
            match fileInput.current with
            | Some input ->
                getDataUrl (unbox<Types.HTMLInputElement>(input))
            | None -> ()

        let onPasteEvent (e: ClipboardEvent) =
            e.preventDefault()
            match fileInput.current with
            | Some input ->
                // only works for pasting image data, not files unfortunately
                let input = unbox<Types.HTMLInputElement>(input)
                e.preventDefault()
                if e.clipboardData.files.length > 0 then
                    input.files <- e.clipboardData.files
                    onFileInputChange null
                else
                    let asText = e.clipboardData.getData("text/plain")
                    if not (System.String.IsNullOrEmpty asText) then
                        setPasteHereValue asText
            | None ->
                ()

        let uploadImage (_: Event) =
            let usrImg =
                match croppedImageBlob with
                | Some blob -> Some (Blob blob)
                | None ->
                    match fileInput.current with
                    | Some input ->
                        let input = unbox<Types.HTMLInputElement>(input)
                        Some (File (input.files.[0]))
                    | None ->
                        None
            match usrImg with
            | None -> ()
            | Some usrimg ->
                promise {
                    try
                        Utils.gtagEvent "UploadImage" "EncodeImageDialog"
                        setEncodeResult Loading
                        let formData = FormData.Create ()
                        match usrimg with
                        | Blob blob -> formData.append("usrimg", blob)
                        | File file -> formData.append("usrimg", file)
                        formData.append("tryalign", "true")

                        let body = Fable.Core.U3.Case2 formData
                        let! res = fetch props.EncodeImageApiLocation [ Method HttpMethod.POST; Body body ]
                        let! json = res.json()
                        let encodeResult : EncodeImageResponse = !!json
                        let guid = System.Guid.Parse encodeResult.guid
                        setEncodeResult (Loaded (guid, encodeResult.did_align))

                    with e ->
                        console.log("Error in promise!", e)
                        setEncodeResult LoadingError
                } |> ignore
            ()

        let resetState () =
            setEncodeResult NotLoading
            setChosenFileDataUrl NotLoading
            setCroppedImageBlob None
            setCropperRotSlider 0
            setIsCropping false
            setPasteHereValue ""

        let onClickOk guid =
            resetState ()
            props.OnImageEncoded guid

        let close _ =
            resetState ()
            props.OnClose ()

        let rotateCrop () =
            match cropperComponent.current with
            | None -> ()
            | Some element ->
                let cropper = unbox<Cropper.CropperComponent> element
                setCropperRotSlider 0
                let options = {
                    immediately = true
                    normalize = true
                    transitions = true
                }
                cropper.rotateImage (-90 - cropperRotSlider) options

        let rotateCropFine newVal =
            match cropperComponent.current with
            | None -> ()
            | Some element ->
                let cropper = unbox<Cropper.CropperComponent> element
                let options = {
                    immediately = true
                    normalize = false
                    transitions = false
                }
                cropper.rotateImage (newVal - cropperRotSlider) options
                setCropperRotSlider newVal

        let useThisCrop () =
            match cropperComponent.current with
            | None -> ()
            | Some element ->
                let cropper = unbox<CropperComponent> element
                let canvas = cropper.getCanvas()
                setIsCropping false
                setEncodeResult NotLoading
                setChosenFileDataUrl Loading
                let gotBlob blob =
                    setCroppedImageBlob (Some blob)
                    setChosenFileDataUrl (Loaded (canvas.toDataURL()))
                canvas.toBlob(gotBlob, "image/jpeg")

        Mui.dialog [
            dialog.open' props.IsOpen
            dialog.onClose (fun _ _ -> close ())
            prop.onPaste onPasteEvent
            dialog.children [
                Mui.dialogTitle [
                    Html.div [
                        prop.style [
                            style.display.flex
                            style.justifyContent.spaceBetween
                        ]
                        prop.children [
                            if isCropping
                            then Html.span "Crop your image"
                            else Html.span "Upload an image"
                            Mui.svgIcon [
                                prop.className "vivus-start"
                                svgIcon.component' logo
                                prop.style [
                                    style.fontSize (length.em 1.5)
                                ]
                            ]
                        ]
                    ]
                ]
                Mui.dialogContent [
                    if isCropping then
                        Column.column [ ] [
                            match chosenFileDataUrl with
                            | Loaded dataUrl ->
                                cropper [
                                    prop.src dataUrl
                                    prop.className "cropper"
                                    prop.style [
                                        style.custom ("aspectRatio", "1")
                                    ]
                                    prop.ref cropperComponent
                                    prop.custom ("stencilProps", {
                                        aspectRatio = 1.
                                        overlayClassName = "face-cropper-stencil-overlay"
                                    })
                                    prop.custom ("imageRestriction", "none")
                                    prop.custom ("autoZoom", "true")
                                ]
                            | Loading
                            | LoadingError
                            | NotLoading ->
                                Mui.typography [
                                    typography.children "You must select or paste a valid image before cropping"
                                    typography.color.error
                                ]

                            Html.div [
                                prop.style [
                                    style.display.flex
                                    style.flexDirection.row
                                    style.justifyContent.center
                                    style.alignItems.center
                                ]
                                prop.children [
                                    Mui.iconButton [
                                        iconButton.children (cropRotateIcon [])
                                        prop.onClick (fun _ -> rotateCrop ())
                                    ]
                                    Mui.typography [
                                        typography.children $"%i{cropperRotSlider}°"
                                    ]
                                ]
                            ]
                            Mui.slider [
                                slider.min -45
                                slider.max +45
                                slider.value cropperRotSlider
                                slider.onChange rotateCropFine
                            ]
                            Column.column [ ] [
                                Mui.typography [ Html.b "Cropping is generally not necessary, as faces are usually auto detected." ]
                                Mui.typography "Try to crop to leave a bit above the top of the head and below the chin."
                                Mui.typography "Lining up the eyes is most important."
                            ]
                            Columns.columns [ Columns.IsMobile ] [
                                Column.column [ Column.Modifiers [ Modifier.TextAlignment (Screen.All, TextAlignment.Left) ] ] [
                                    Mui.button [
                                        button.children "Cancel"
                                        button.color.default'
                                        button.variant.contained
                                        prop.onClick (fun _ -> setIsCropping false)
                                    ]
                                ]
                                Column.column [ Column.Modifiers [ Modifier.TextAlignment (Screen.All, TextAlignment.Right) ] ] [
                                    Mui.button [
                                        button.children "Use Crop"
                                        button.color.primary
                                        button.variant.contained
                                        prop.onClick (fun _ -> useThisCrop ())
                                    ]
                                ]
                            ]
                        ]
                    else
                        Mui.dialogContentText [
                            dialogContentText.component' "div"
                            dialogContentText.children [
                                Html.span "You can upload an image of a real face to "
                                Html.b siteName
                                Html.span ". We will attempt to find a value which approximates that face."
                                Html.p "For best results, look straight forward at the camera."
                                Html.p "Either choose an image file or paste an image from the clipboard."
                            ]
                        ]
                        Column.column [ ] [
                            Columns.columns [ ] [
                                Mui.input [
                                    input.type' "file"
                                    input.inputProps [
                                        prop.accept "image/jpeg, image/png, image/webp"
                                    ]
                                    input.fullWidth true
                                    input.required true
                                    input.inputRef fileInput
                                    input.onChange onFileInputChange
                                ]
                            ]
                            Columns.columns [ ] [
                                Mui.textField [
                                    textField.margin.normal
                                    textField.autoFocus true
                                    textField.value pasteHereValue
                                    textField.placeholder "Or paste image here"
                                    textField.fullWidth true
                                    prop.onPaste onPasteEvent
                                    textField.onChange setPasteHereValue
                                    if not (System.String.IsNullOrEmpty pasteHereValue) then
                                        textField.error true
                                        textField.helperText "Paste an actual image, not text."
                                ]
                            ]

                            match chosenFileDataUrl with
                            | NotLoading ->
                                ()
                            | Loading ->
                                Columns.columns [ ] [
                                    Column.column [ ] [
                                        Mui.circularProgress [
                                        ]
                                    ]
                                ]
                            | LoadingError ->
                                Columns.columns [ ] [
                                    Column.column [ ] [
                                        errorIcon ()
                                        Html.p "Something went wrong loading file. Try picking another image"
                                    ]
                                ]
                            | Loaded dataUrl when isInvalidImageDataUrl dataUrl ->
                                Columns.columns [ ] [
                                    Column.column [ ] [
                                        errorIcon ()
                                        Html.p "Not a valid image"
                                    ]
                                ]
                            | Loaded dataUrl ->
                                Columns.columns [ ] [
                                    Column.column [ ] [
                                        Html.div [
                                            Html.img [
                                                prop.style [
                                                    style.maxWidth (length.percent 100)
                                                    style.maxHeight (length.percent 100)
                                                    style.maxHeight (length.calc "max(100%, 400px)")
                                                ]
                                                prop.src dataUrl
                                            ]
                                        ]
                                        Html.div [
                                            Mui.button [
                                                button.variant.text
                                                button.children "Crop"
                                                prop.onClick (fun _ -> setIsCropping true)
                                            ]
                                        ]
                                    ]
                                    Column.column [ ] [
                                        match encodedImageResult with
                                        | LoadingError
                                        | NotLoading ->
                                            centerInGrid [
                                                if encodedImageResult = LoadingError then
                                                    errorIcon ()
                                                    Html.p "Something went wrong. Service may be down."

                                                Mui.button [
                                                    prop.type'.submit
                                                    button.children "Upload"
                                                    prop.onClick uploadImage
                                                    button.variant.contained
                                                    button.color.primary
                                                ]
                                            ]
                                        | Loading ->
                                            centerInGrid [
                                                Mui.circularProgress [
                                                ]
                                            ]
                                        | Loaded (guid, _) ->
                                            props.RenderImgGuid guid

                                    ]
                                ]

                            match encodedImageResult with
                            | Loaded (_, did_align) when not did_align ->
                                Columns.columns [ ] [
                                    Column.column [ Column.Modifiers [ Modifier.TextAlignment (Screen.All, TextAlignment.Left) ] ] [
                                        Mui.typography [
                                            typography.color.error
                                            typography.children "Unable to align face."
                                        ]
                                        Mui.typography [
                                            typography.color.textPrimary
                                            typography.children ("When the face isn't aligned you may get strange results. " +
                                                "Try a different image or manually crop it to a square before uploading.")
                                        ]
                                    ]
                                ]
                            | _ ->
                                ()

                            Columns.columns [ Columns.IsMobile ] [
                                Column.column [ Column.Modifiers [ Modifier.TextAlignment (Screen.All, TextAlignment.Left) ] ] [
                                    Mui.button [
                                        button.children "Cancel"
                                        button.color.default'
                                        button.variant.contained
                                        prop.onClick close
                                    ]
                                ]
                                Column.column [ Column.Modifiers [ Modifier.TextAlignment (Screen.All, TextAlignment.Right) ] ] [
                                    Mui.button [
                                        button.children "OK"
                                        button.color.primary
                                        button.variant.contained

                                        match encodedImageResult with
                                        | NotLoading
                                        | LoadingError
                                        | Loading ->
                                            button.disabled true
                                        | Loaded (guid, _) ->
                                            button.disabled false
                                            prop.onClick (fun _ -> onClickOk guid)
                                    ]
                                ]
                            ]
                        ]
                ]
            ]
        ]