module App

open Elmish
open Elmish.React
open Fable.MaterialUI.Icons
open Fable.React
// open Fable.React.Props
open Feliz
open Feliz.MaterialUI
open Feliz.prop
open Feliz.Router
open Fulma
open Utils

type State = {
    LeftValue : string
    RightValue : string
    VidValues : (string * string) option
}

let parseUrl segments =
    let fromValue, toValue =
        match segments with
        | [ Route.Query [ "from_value", fromValue; "to_value", toValue ] ] -> Some fromValue, Some toValue
        | [ Route.Query [ "to_value", toValue ] ] -> None, Some toValue
        | [ Route.Query [ "from_value", fromValue ] ] -> Some fromValue, None
        | _ -> None, None

    {
        LeftValue = Option.defaultValue "hello" fromValue
        RightValue = Option.defaultValue ("Face of the day: " + System.DateTime.Today.ToString("yyyy/MM/dd")) toValue
        VidValues = Option.map2 (fun a b -> a,b) fromValue toValue
    }

type Msg =
    | SetLeftValue of string
    | SetRightValue of string
    | UrlChanged of string list
    | MakeVid

let imgSrc (dim:int) value =
    sprintf "https://api.checkface.ml/api/face/?dim=%i&value=%s" dim (encodeUriComponent value)


let vidSrc (dim:int) (fromValue, toValue) =
    sprintf "https://api.checkface.ml/api/mp4/?dim=%i&from_value=%s&to_value=%s" dim (encodeUriComponent fromValue) (encodeUriComponent toValue)


let init() = parseUrl (Router.currentPath()), Cmd.none

let update msg state : State * Cmd<Msg> =
    match msg with
    | SetLeftValue value ->
        { state with LeftValue = value }, Cmd.none
    | SetRightValue value ->
        { state with RightValue = value }, Cmd.none
    | MakeVid ->
        state, Cmd.navigatePath("/", ["from_value", state.LeftValue; "to_value", state.RightValue])
    | UrlChanged segments ->
        parseUrl segments, Cmd.none

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
    React.router [
        router.pathMode
        router.onUrlChanged (UrlChanged >> dispatch)
        router.children [
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
            ]
            renderContent state dispatch
        ]
    ]



#if DEBUG
printfn "Enabled HMR"
open Elmish.HMR
#endif

Program.mkProgram init update render
|> Program.withReactSynchronous "elmish-app"
|> Program.run