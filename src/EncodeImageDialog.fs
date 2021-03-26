module EncodeImageDialog
open Feliz
open Feliz.MaterialUI
open Fulma
open Browser.Types
open Browser
open Fable.Core.JsInterop

type Props = {
    OnClose : unit -> unit
    IsOpen : bool
}

let encodeImageDialog = React.functionComponent ("encode-image-dialog", fun (props: Props) ->

        let fileInput = React.useRef None
        let chosenFileDataUrl, setChosenFileDataUrl = React.useState None

        let getDataUrl (input:Types.HTMLInputElement) =
            if input.files.length = 1
            then
                let file = input.files.[0]
                let reader = FileReader.Create ()
                reader.onload <- fun e -> printfn "setting dataUrl"; setChosenFileDataUrl (Some e.target?result)
                printfn "readAsDataUrl"
                reader.readAsDataURL(file)

        let onFileInputChange (e: Event) =
            match fileInput.current with
            | Some input -> getDataUrl (unbox<Types.HTMLInputElement>(input))
            | None -> ()

        Mui.dialog [
            dialog.open' props.IsOpen
            dialog.onClose (fun _ _ -> props.OnClose ())
            dialog.children [
                Mui.dialogTitle [
                    dialogTitle.children "Upload an image"
                ]
                Mui.dialogContent [
                    Mui.dialogContentText "You can upload an image of a real face. We will attempt to find a value which approximates that face."
                    Column.column [ ] [
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

                        // renderImageByValue "hellooo"
                        printfn "chosenFileDataUrl is %A" chosenFileDataUrl
                        match chosenFileDataUrl with
                        | None -> ()
                        | Some dataUrl ->
                            Html.img [
                                prop.width 200
                                prop.src dataUrl
                            ]

                            Mui.button [
                                button.type'.submit
                                button.children "Upload"
                            ]

                        Columns.columns [ ] [
                            Column.column [ Column.Modifiers [ Modifier.TextAlignment (Screen.All, TextAlignment.Right) ] ] [
                                Mui.button [
                                    button.children "Use"
                                    button.disabled true
                                    // button.disabled false
                                    button.color.primary
                                    button.variant.contained
                                ]
                            ]
                        ]
                    ]
                ]
            ]
        ]
    )