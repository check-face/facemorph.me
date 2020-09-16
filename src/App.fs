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

let videoDim = 512
let imgDim = 300
let ogImgDim = 1024
let ogVideoDim = 512
let siteName = "facemorph.me"
let canonicalBaseUrl = "https://facemorph.me"

type State = {
    LeftValue : string
    RightValue : string
    VidValues : (string * string) option
}

let parseUrl (path, query) =
    let fromValue = Map.tryFind "from_value" query
    let toValue = Map.tryFind "to_value" query

    {
        LeftValue = Option.defaultValue "hello" fromValue
        RightValue = Option.defaultValue (System.DateTime.Today.ToString("yyyy-MM-dd")) toValue
        VidValues = Option.map2 (fun a b -> a,b) fromValue toValue
    }

type Msg =
    | SetLeftValue of string
    | SetRightValue of string
    | UrlChanged of (string list * Map<string, string>)
    | MakeVid

let imgSrc (dim:int) value =
    sprintf "https://api.checkface.ml/api/face/?dim=%i&value=%s" dim (encodeUriComponent value)

let imgAlt value = sprintf "Generated face for value %s" value

let vidSrc (dim:int) (fromValue, toValue) =
    sprintf "https://api.checkface.ml/api/mp4/?dim=%i&from_value=%s&to_value=%s" dim (encodeUriComponent fromValue) (encodeUriComponent toValue)

let getCurrentPath _ =
    Browser.Dom.window.location.pathname, Browser.Dom.window.location.search

let parseSegments (pathName, queryString) =
    let urlSegments = Router.urlSegments pathName RouteMode.Path
    let urlParams =
        (Router.createUrlSearchParams queryString).entries()
        |> Seq.map (fun arr -> (arr.[0], arr.[1]))
        |> Map.ofSeq
    urlSegments, urlParams

let initByUrl = parseSegments >> parseUrl
let init() = getCurrentPath() |> initByUrl, Cmd.none

let update msg state : State * Cmd<Msg> =
    match msg with
    | SetLeftValue value ->
        { state with LeftValue = value }, Cmd.none
    | SetRightValue value ->
        { state with RightValue = value }, Cmd.none
    | MakeVid ->
        state, Cmd.navigatePath("/", ["from_value", state.LeftValue; "to_value", state.RightValue])
    | UrlChanged (path, query) ->
        parseUrl (path, query), Cmd.none

let renderSetpoint autoFocus value (label:string) (onChange: string -> unit) =
    Column.column [ ] [
        Html.div [
            prop.children [
                Html.img [
                    prop.src (imgSrc imgDim value)
                    prop.width imgDim
                    prop.height imgDim
                    prop.alt (imgAlt value)
                ]
            ]
        ]
        Mui.textField [
            textField.value value
            textField.onChange onChange
            textField.placeholder "Just type anything"
            textField.autoFocus autoFocus
            textField.inputProps [
                prop.style [ style.textAlign.center ]
            ]
            prop.style [
                style.width (length.percent 100)
                style.maxWidth (length.px imgDim)
            ]
            textField.variant.outlined
            textField.label label
            textField.margin.normal
        ]
    ]

let renderVideo =
    function
    | None -> Html.none
    | Some (fromValue, toValue) ->
        Html.div [
            Feliz.Html.video [
                prop.src (vidSrc videoDim (fromValue, toValue))
                prop.controls true
                prop.autoPlay true
                prop.loop true
                prop.muted true
                prop.style [
                    style.display.block
                    style.margin.auto
                ]
                prop.poster (imgSrc imgDim (fromValue)) //imgDim is already in cache because fromValue is displayed at imgDim
                prop.width videoDim
                prop.height videoDim
                prop.alt (sprintf "Morph from %s to %s" fromValue toValue)
            ]
        ]

let morphButton =
    Column.column [ ] [
        Mui.button [
            button.children "Morph"
            button.type'.submit
            button.color.primary
            button.variant.contained
            button.size.large
        ]
    ]

let renderContent (state:State) (dispatch: Msg -> unit) =
    Html.form [
        prop.onSubmit (fun e -> e.preventDefault(); dispatch MakeVid)
        prop.children [
            Mui.container [
                Html.div [
                    prop.className "morph-content"
                    prop.children [
                        renderSetpoint true state.LeftValue "Morph from" (SetLeftValue >> dispatch)
                        renderSetpoint false state.RightValue "Morph to" (SetRightValue >> dispatch)
                        morphButton
                        renderVideo state.VidValues
                    ]
                ]
            ]
        ]
    ]


let explainContent : string = Fable.Core.JsInterop.importDefault "./explain.md"
let explaination largeMargin =
        Mui.container [
            container.maxWidth.md
            prop.style [
                style.marginTop (if largeMargin then 300 else 100)
                style.marginBottom 200
            ]
            container.children [
                Content.content [ Content.Size IsLarge ] [
                    Html.div [
                        prop.dangerouslySetInnerHTML explainContent //rendered from markdown
                    ]
                ]
            ]
        ]

let darkTheme = Styles.createMuiTheme [ theme.palette.type'.dark ]
let lightTheme = Styles.createMuiTheme [ theme.palette.type'.light ]

let themedApp' = React.functionComponent("themed-app", fun (props: {| children: ReactElement list |}) ->
    let theme = if Hooks.useMediaQuery("@media (prefers-color-scheme: dark)") then darkTheme else lightTheme
    Mui.themeProvider [
        themeProvider.theme theme
        themeProvider.children props.children
    ])

let themedApp children = themedApp' {| children = children |}

let render (state:State) (dispatch: Msg -> unit) =
    themedApp [
        Html.div [
            prop.style [ style.marginBottom (length.em 2) ]
            prop.children [
                Column.column [ ] [
                    Html.a [
                        prop.href "/"
                        prop.children [ Heading.h1 [ ] [ str siteName ] ]
                    ]
                ]
            ]
        ]
        renderContent state dispatch
        explaination state.VidValues.IsNone
    ]

let inline helmet props = createElement (Fable.Core.JsInterop.import "Helmet" "react-helmet") props

let meta property content =
    Html.meta [
        prop.custom ("property", property)
        prop.custom ("content", content)
    ]

let viewHead state =
    let title, description =
        match state.VidValues with
        | Some (fromValue, toValue) ->
            sprintf "%s to %s" fromValue toValue,
            sprintf "Morph generated faces from %s to %s" fromValue toValue
        | None ->
            siteName,
            "Generate faces on the fly and morph between them"



    let canonicalUrl =
        canonicalBaseUrl + Feliz.Router.Router.formatPath("/",
            [ 
                match state.VidValues with
                | Some (fromValue, toValue) ->
                    "from_value", fromValue
                    "to_value", toValue
                | None ->
                    ()
            ])

    let videoSrc = Option.map (vidSrc ogVideoDim) state.VidValues
    helmet [ 
        prop.children [
            Html.title title
            meta "og:title" title
            meta "og:description" description
            meta "og:site_name" siteName
            meta "og:image" (imgSrc ogImgDim state.LeftValue)
            meta "og:image:alt" (imgAlt state.LeftValue)
            meta "og:image:width" ogImgDim
            meta "og:image:height" ogImgDim
            meta "og:image:type" "image/jpeg"

            Html.link [ prop.custom ("rel", "canonical"); prop.href canonicalUrl ]
            meta "og:url" canonicalUrl

            match videoSrc with
            | None ->
                meta "og:type" "website"
            | Some videoSrc ->
                meta "og:type" "video.other"
                meta "og:video" videoSrc
                meta "og:video:secure_url" videoSrc
                meta "og:video:type" "video/mp4"
                meta "og:video:width" ogVideoDim
                meta "og:video:height" ogVideoDim
                meta "twitter:card" "player"
                meta "twitter:player" (videoSrc + "&embed_html=true")
                meta "twitter:player:width" ogVideoDim
                meta "twitter:player:height" ogVideoDim
        ]
    ]


let view state dispatch =
    React.router [
        router.pathMode
        router.onUrlChanged (getCurrentPath >> parseSegments >> UrlChanged >> dispatch)
        router.children [
            viewHead state
            render state dispatch
        ]
    ]