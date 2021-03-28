module EncodeImageDialog
open Feliz
open Fable.MaterialUI.Icons
open Feliz.MaterialUI
open Fulma
open Browser.Types
open Browser
open Fable.Core.JsInterop
open Fetch
open Checkface
open Feliz.MaterialUI.themeStatic.theme
type Props = {
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

let encodeImageDialog = React.functionComponent ("encode-image-dialog", fun (props: Props) ->

        let fileInput = React.useRef None
        let chosenFileDataUrl, setChosenFileDataUrl = React.useState (NotLoading)
        let encodedImageResult, setEncodeResult = React.useState (NotLoading)

        let getDataUrl (input:Types.HTMLInputElement) =
            if input.files.length = 1
            then
                let file = input.files.[0]
                let reader = FileReader.Create ()
                reader.onload <- fun e -> setChosenFileDataUrl (Loaded e.target?result)
                reader.onerror <- fun e -> setChosenFileDataUrl NotLoading
                printfn "readAsDataUrl"
                reader.readAsDataURL(file)

        let onFileInputChange (e: Event) =
            setChosenFileDataUrl Loading
            setEncodeResult NotLoading
            match fileInput.current with
            | Some input -> getDataUrl (unbox<Types.HTMLInputElement>(input))
            | None -> ()

        let uploadImage (_: Event) =

            match fileInput.current with
            | None -> ()
            | Some input ->
                promise {
                    try
                        setEncodeResult Loading
                        let input = unbox<Types.HTMLInputElement>(input)
                        let usrimg = input.files.[0]
                        let formData = FormData.Create ()
                        formData.append("usrimg", usrimg)
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

        let onClickOk guid =
            resetState ()
            props.OnImageEncoded guid

        let close _ =
            resetState ()
            props.OnClose ()


        Mui.dialog [
            dialog.open' props.IsOpen
            dialog.onClose (fun _ _ -> close ())
            dialog.children [
                Mui.dialogTitle [
                    dialogTitle.children "Upload an image"
                ]
                Mui.dialogContent [
                    Mui.dialogContentText "You can upload an image of a real face. We will attempt to find a value which approximates that face."
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

                        // renderImageByValue "hellooo"
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
                                                button.type'.submit
                                                button.children "Upload"
                                                prop.onClick uploadImage
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
                        | Loaded (_, did_align) when did_align = false->
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
    )