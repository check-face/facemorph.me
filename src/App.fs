module App

open Elmish
open Elmish.React
open Fable.MaterialUI.Icons
open Fable.React
// open Fable.React.Props
open Feliz
open Feliz.MaterialUI
open Feliz.prop
open Fulma
open Utils

type State = {
    LeftValue : string
    RightValue : string
    VidValues : (string * string) option
}

type Msg =
    | SetLeftValue of string
    | SetRightValue of string
    | MakeVid

let imgSrc (dim:int) value =
    sprintf "https://api.checkface.ml/api/face/?dim=%i&value=%s" dim (encodeUriComponent value)


let vidSrc (dim:int) (fromValue, toValue) =
    sprintf "https://api.checkface.ml/api/mp4/?dim=%i&from_value=%s&to_value=%s" dim (encodeUriComponent fromValue) (encodeUriComponent toValue)


let init() = {
    LeftValue = "hello"
    RightValue = "Face of the day: " + System.DateTime.Today.ToString("yyyy/MM/dd")
    VidValues = None
}


let update (msg: Msg) (state: State): State =
    match msg with
    | SetLeftValue value ->
        { state with LeftValue = value }
    | SetRightValue value ->
        { state with RightValue = value }
    | MakeVid ->
        { state with VidValues = Some (state.LeftValue, state.RightValue) }

let renderSetpoint value (onChange: string -> unit) =
    Column.column [ ] [
        Html.img [ prop.src (imgSrc 300 value) ]
        Mui.textField [
            textField.value value
            textField.onChange onChange
            textField.fullWidth true
            textField.placeholder "Just type anything"
            textField.inputProps [
                prop.style [ style.textAlign.center ]
            ]
        ]
    ]

let renderContent (state:State) (dispatch: Msg -> unit) =
    Html.form [
        prop.onSubmit (fun e -> e.preventDefault(); dispatch MakeVid)
        prop.children [
            Mui.container [
                Columns.columns [ ] [
                    renderSetpoint state.LeftValue (SetLeftValue >> dispatch)
                    renderSetpoint state.RightValue (SetRightValue >> dispatch)
                ]
                
                Column.column [ ] [
                    Mui.button [
                        button.children "Make vid"
                        button.type'.submit
                        button.color.primary
                        button.variant.contained
                    ]
                ]
            ]

            Html.div [
                match state.VidValues with
                | None -> ()
                | Some values ->
                    Feliz.Html.video [
                        let dim = 512
                        prop.src (vidSrc dim values)
                        prop.controls true
                        prop.autoPlay true
                        prop.loop true
                        prop.muted true
                        prop.style [
                            style.display.block
                            style.margin.auto
                        ]
                    ]
            ]
        ]
    ]

let render (state:State) (dispatch: Msg -> unit) =
    Html.div [
        Column.column [ ] [
            Heading.h1 [ ] [ str "morphdev" ]
            Mui.hidden [
                hidden.smDown true
                hidden.children [
                    Heading.h3 [ Heading.IsSubtitle ] [
                        str "morph with "
                        Html.a [
                           prop.children (str "checkface")
                           prop.href "https://checkface.ml"
                        ]
                        str " values"
                    ]
                ]
            ]
        ]
        renderContent state dispatch
    ]



#if DEBUG
printfn "Enabled HMR"
open Elmish.HMR
#endif

Program.mkSimple init update render
|> Program.withReactSynchronous "elmish-app"
|> Program.run