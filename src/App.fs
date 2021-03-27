module App

open Elmish
open Elmish.React
open Fable.MaterialUI.Icons
open Fable.React
open Feliz
open Feliz.MaterialUI
open Feliz.prop
open Feliz.Router
open Fulma
open Utils

open Checkface
open FancyButton
open SliderMorph
open EncodeImageDialog
open Share

let videoDim = 512
let imgDim = 300
let imgSizesSet = [ 300; 512; 1024 ]
let linkpreviewWidth = 1200
let linkpreviewHeight = 628
let ogImgDim = 512
let ogVideoDim = 512
let siteName = "facemorph.me"
let canonicalBaseUrl = "https://facemorph.me"
let contactEmail = "checkfaceml@gmail.com"
let githubRepo = "check-face/facemorph.me"
let apiAddr = "https://api.checkface.ml"
let encodeApiAddr = apiAddr + "/api/encodeimage/"

type Side = | Left | Right




type State = {
    VidValues : (CheckfaceSrc * CheckfaceSrc) option
    LeftValue : CheckfaceSrc
    RightValue : CheckfaceSrc
    UploadDialogSide : Side option
    ShareOpen : bool
    ShareLinkMsg : string option
    IsMorphLoading : bool
    UseSlider : bool
}

type UrlState = {
    FromValue : string option
    ToValue : string option
    FromGuid : System.Guid Option
    ToGuid : System.Guid Option
    FromSeed : int option
    ToSeed : int option
}

let parseUrl (path, query) =
    {
        FromValue = Map.tryFind "from_value" query
        ToValue = Map.tryFind "to_value" query
        FromGuid = Map.tryFind "from_guid" query |> Option.bind (System.Guid.TryParse >> tryToOption)
        ToGuid = Map.tryFind "to_guid" query |> Option.bind (System.Guid.TryParse >> tryToOption)
        FromSeed = Map.tryFind "from_seed" query |> Option.bind (System.Int32.TryParse >> tryToOption)
        ToSeed = Map.tryFind "to_seed" query |> Option.bind (System.Int32.TryParse >> tryToOption)
    }

let formatPathForVidValues vidValues =
    Feliz.Router.Router.formatPath("/",
        [ 
            match vidValues with
            | Some (fromValue, toValue) ->
                match fromValue with
                | CheckfaceValue value ->
                    "from_value", value
                | Guid guid ->
                    "from_guid", guid.ToString()
                | Seed seed ->
                    "from_seed", seed.ToString()

                match toValue with
                | CheckfaceValue value ->
                    "to_value", value
                | Guid guid ->
                    "to_guid", guid.ToString()
                | Seed seed ->
                    "to_seed", seed.ToString()
            | None ->
                ()
        ])

let canonicalUrl state =
    canonicalBaseUrl + formatPathForVidValues state.VidValues

let pageTitle vidValues =
    match vidValues with
    | Some (fromValue, toValue) ->
        sprintf "%s to %s" (shortCheckfaceSrcDesc fromValue) (shortCheckfaceSrcDesc toValue)
    | None ->
        siteName

let pageDescription = function
    | Some (fromValue, toValue) ->
            sprintf "Morph generated faces from %s to %s" (shortCheckfaceSrcDesc fromValue) (shortCheckfaceSrcDesc toValue)
    | None ->
            "Generate faces on the fly and morph between them"

type Msg =
    | SetLeftValue of CheckfaceSrc
    | SetRightValue of CheckfaceSrc
    | ClickUploadRealImage of Side
    | CloseUploadDialog
    | ImageEncoded of System.Guid
    | UrlChanged of (string list * Map<string, string>)
    | MakeVid
    | ShareMsg of ShareMsg
    | MorphLoaded
    | SetUseSlider of bool

let valueParam value =
    match value with
    | Guid guid -> sprintf "guid=%s" (guid.ToString())
    | CheckfaceValue value -> sprintf "value=%s" (encodeUriComponent value)
    | Seed seed -> sprintf "seed=%i" seed

let imgSrc (dim:int) isWebp value =
    sprintf "%s/api/face/?dim=%i&%s&format=%s" apiAddr dim (valueParam value) (if isWebp then "webp" else "jpg")

let describeCheckfaceSrc =
    function
    | CheckfaceValue value -> sprintf "value %s" value
    | Seed seed -> sprintf "seed %i" seed
    | Guid guid -> sprintf "custom latent (%s)" (guid.ToString().Substring(0, 6))

let imgAlt value =
    "Generated face for " + describeCheckfaceSrc value

let vidMorphAlt (fromValue, toValue) =
    sprintf "Morph from %s to %s" (describeCheckfaceSrc fromValue) (describeCheckfaceSrc toValue)

let linkpreviewAlt (fromValue, toValue) = sprintf "%s + %s" fromValue toValue

let vidSrc (dim:int) (fromValue, toValue) =
    sprintf "%s/api/mp4/?dim=%i&from_%s&to_%s" apiAddr dim (valueParam fromValue) (valueParam toValue)

let morphframeSrc (fromValue, toValue) dim numFrames frameNum =
    sprintf "%s/api/morphframe/?dim=%i&linear=true&from_%s&to_%s&num_frames=%i&frame_num=%i" apiAddr dim (valueParam fromValue) (valueParam toValue) numFrames frameNum

let linkpreviewSrc (width:int) (fromValue, toValue) =
    sprintf "%s/api/linkpreview/?width=%i&from_%s&to_%s" apiAddr width (valueParam fromValue) (valueParam toValue)

let getCurrentPath _ =
    Browser.Dom.window.location.pathname, Browser.Dom.window.location.search

let parseSegments (pathName, queryString) =
    let urlSegments = Router.urlSegments pathName RouteMode.Path
    let urlParams =
        (Router.createUrlSearchParams queryString).entries()
        |> Seq.map (fun arr -> (arr.[0], arr.[1]))
        |> Map.ofSeq
    urlSegments, urlParams

let urlFromCheckfaceSrc urlState =
    match urlState.FromValue, urlState.FromGuid, urlState.FromSeed with
    | Some value, _, _ -> Some (CheckfaceValue value)
    | None, Some guid, _ -> Some (Guid guid)
    | None, None, Some seed -> Some (Seed seed)
    | None, None, None -> None

let urlToCheckfaceSrc urlState =
    match urlState.ToValue, urlState.ToGuid, urlState.ToSeed with
    | Some value, _, _ -> Some (CheckfaceValue value)
    | None, Some guid, _ -> Some (Guid guid)
    | None, None, Some seed -> Some (Seed seed)
    | None, None, None -> None

let defaultFromValue = Option.defaultValue (CheckfaceValue "hello")
let defaultToValue = Option.defaultWith (fun () -> CheckfaceValue (System.DateTime.Today.ToString("yyyy-MM-dd")))

let initByUrlstate urlState =
    let fromValue = urlFromCheckfaceSrc urlState
    let toValue = urlToCheckfaceSrc urlState
    let vidValues = Option.map2 (fun a b -> a,b) fromValue toValue
    {
        LeftValue = defaultFromValue fromValue
        RightValue = defaultToValue toValue
        UploadDialogSide = None
        VidValues = vidValues
        ShareOpen = false
        ShareLinkMsg = None
        IsMorphLoading = false
        UseSlider = false
    }
let initByUrl = parseSegments >> parseUrl >> initByUrlstate
let init() = getCurrentPath() |> initByUrl, Cmd.none

let updateShare msg state =
    match msg with
    | OpenShare ->
        { state with ShareOpen = true }, Cmd.none
    | CloseShare ->
        { state with ShareOpen = false }, Cmd.none
    | CopyLink ->
        gtagEvent "CopyLink" "Share"

        state,
        match clipboard with
        | Some clipboard ->
            Cmd.OfPromise.either
                <| clipboard.writeText
                <| canonicalUrl state
                <| fun _ -> ShareMsg (SetShareMsg "Copied link to clipboard!")
                <| fun _ -> ShareMsg (SetShareMsg "Failed to copy to clipboard 😢")
        | None -> Cmd.ofMsg (ShareMsg (SetShareMsg "Failed to copy to clipboard 😢"))

    | NavigatorShare ->
        gtagEvent "NavigatorShareOpen" "Share"

        state,
        match navigatorCanShare, state.VidValues with
        | true, None -> 
            Cmd.OfPromise.result (promise {
                ignore <| navigatorShare (canonicalUrl state) (pageTitle state.VidValues) (pageDescription state.VidValues)
                return ShareMsg (SetShareMsg "Sharing page!")
            })
        | true, Some vidValues ->
            Cmd.OfPromise.result (promise {
                let fileShare = {
                    FileName = pageTitle state.VidValues + ".mp4"
                    Title = pageTitle state.VidValues
                    FileUrl = vidSrc videoDim vidValues
                    Text = (pageDescription state.VidValues)
                    Url = (canonicalUrl state)
                    ContentType = "video/mp4"
                }
                let! couldShareFile = shareFileFromUrl fileShare
                if couldShareFile then
                    return ShareMsg (SetShareMsg "Sharing morph!")
                else
                    return ShareMsg CopyLink
            })
        | false, _ ->
            Cmd.ofMsg (ShareMsg CopyLink)

    | SetShareMsg msg ->
        { state with ShareLinkMsg = Some msg },
        Cmd.OfPromise.result (promise {
            do! Promise.sleep 1000
            return ShareMsg ResetShareMsg
        })
       
    | ResetShareMsg ->
        { state with ShareLinkMsg = None }, Cmd.none

let update msg state : State * Cmd<Msg> =
    match msg with
    | SetLeftValue value ->
        { state with LeftValue = value }, Cmd.none
    | SetRightValue value ->
        { state with RightValue = value }, Cmd.none
    | ClickUploadRealImage side ->
        { state with UploadDialogSide = Some side }, Cmd.none
    | CloseUploadDialog ->
        { state with UploadDialogSide = None }, Cmd.none
    | ImageEncoded guid ->
        let leftValue, rightValue =
            match state with
            | { UploadDialogSide = Some Right; LeftValue = lVal } -> lVal, Guid guid
            | { RightValue = rVal } -> Guid guid, rVal //default to setting left side is side is not set
        { state with UploadDialogSide = None; LeftValue = leftValue; RightValue = rightValue }, Cmd.none
    | MakeVid when state.VidValues = Some (state.LeftValue, state.RightValue) ->
        state, Cmd.none
    | MakeVid ->
        gtagEvent "MakeVid" "Video"
        state, Some (state.LeftValue, state.RightValue) |> formatPathForVidValues |> Cmd.navigatePath
    | UrlChanged (path, query) ->
        let urlState = parseUrl (path, query)
        let urlFromSrc = urlFromCheckfaceSrc urlState
        let urlToSrc = urlToCheckfaceSrc urlState
        let vidValues = Option.map2 (fun a b -> a,b) urlFromSrc urlToSrc
        //changed and has something to be loading
        let isLoading = vidValues <> state.VidValues && vidValues.IsSome
        {
            state with
                LeftValue = defaultFromValue urlFromSrc
                RightValue = defaultToValue urlToSrc
                VidValues = vidValues
                ShareOpen = false //always reset share state
                ShareLinkMsg = None
                IsMorphLoading = isLoading //set loading when has something to load
        }, Cmd.none
    | ShareMsg msg ->
        updateShare msg state
    | MorphLoaded ->
        { state with IsMorphLoading = false }, Cmd.none
    | SetUseSlider v ->
        { state with UseSlider = v }, Cmd.none

let logo : ReactElementType = Fable.Core.JsInterop.importDefault "./public/logo.svg"
let animatedLogo : ReactElementType = Fable.Core.JsInterop.importDefault "./public/logo-animated.svg"

let renderImageByValue value =
    //use source and srcset to allow picking webp if supported and to pick best size based on pixel scaling
    let src = imgSrc imgDim false value
    let srcSet isWebp =
        imgSizesSet
        |> List.map (fun dim -> sprintf "%s %iw" (imgSrc dim isWebp value) dim)
        |> String.concat ","
    let sizes = (sprintf "%ipx" imgDim) //displayed size is around imgDim in css px regardless of device scaling
    Html.picture [
        Html.source [
            prop.type' "image/webp"
            prop.srcset <| srcSet true
            prop.sizes sizes
        ]
        Html.source [
            prop.type' "image/jpeg"
            prop.srcset <| srcSet false
            prop.sizes sizes
        ]
        Html.img [
            prop.src src
            prop.sizes sizes

            prop.width imgDim
            prop.height imgDim
            prop.alt (imgAlt value)
        ]
    ]

let renderSetpoint autoFocus value id (label:string) (onChange: CheckfaceSrc -> unit) (onUploadRealImage: unit -> unit) =
    Column.column [ ] [
        Html.div [
            prop.children [
                renderImageByValue value
            ]
        ]
        Mui.textField [
            match value with
            | CheckfaceValue value ->
                textField.value value
            | Guid _
            | Seed _ ->
                textField.value (shortCheckfaceSrcDesc value)
                textField.disabled true //disable text field when not normal value
            textField.onChange (CheckfaceValue >> onChange)
            textField.placeholder "Just type anything"
            textField.autoFocus autoFocus
            textField.inputProps [
                prop.style [ style.textAlign.center ]
                autoCapitalize.off
            ]
            prop.style [
                style.width (length.percent 100)
                style.maxWidth (length.px imgDim)
            ]
            textField.variant.outlined
            textField.label label
            textField.margin.normal
            textField.id id
        ]
        Html.div [
            Mui.button [
                button.children "Upload real image"
                button.variant.contained
                button.color.primary
                prop.onClick (ignore >> onUploadRealImage)
            ]
        ]
    ]

let renderMorph values useSlider dispatch =
    match values with
    | None -> Html.none
    | Some (fromValue, toValue) ->
        Html.div [
            if useSlider then
                sliderMorph {
                    Values = (fromValue, toValue)
                    OnLoaded = (fun _ -> dispatch MorphLoaded)
                    FrameSrc = morphframeSrc
                    Dim = videoDim
                    NumFrames = 25
                }
            else
                let posterImgSrc = imgSrc imgDim false (fromValue) //imgDim is already in cache because fromValue is displayed at imgDim
                Html.img [
                    // A layout hack because video doesn't respect height attribute for auto sizing while loading,
                    // but img does. dummyImg is used to prevent vertical flickr while vid is loading (or if vid fails to load entirely).
                    // Do not place a src on this image because if it loads a broken image then it stops respecting
                    // auto sizing based on height prop. Once aspect-rasio css or intrinsicsize video attr are available this may not be necessary.
                    prop.width videoDim
                    prop.height videoDim
                    prop.className "morph-dummyImg"
                ]
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
                    prop.className "morph-vid"
                    prop.poster posterImgSrc 
                    prop.width videoDim
                    prop.height videoDim
                    prop.alt (vidMorphAlt (fromValue, toValue))
                    prop.onLoadedData (fun _ -> dispatch MorphLoaded)
                ]
            Mui.formControlLabel [
                prop.style [
                    style.display.block
                    style.marginLeft (length.px 5)
                    style.custom ("justifySelf", "center")
                    style.width (length.percent 100)
                    style.maxWidth (length.px videoDim)
                    style.height (length.px 0) //don't make morph button any lower
                ]
                formControlLabel.control (
                    Mui.checkbox [
                        checkbox.checked' useSlider
                        checkbox.onChange (SetUseSlider >> dispatch)
                    ]
                )
                formControlLabel.label "Use Slider"
            ]
        ]

let morphButton isLoading =
    Column.column [ ] [
        fancyButton
            {|
                buttonProps = 
                [
                    button.type'.submit
                    button.color.primary
                    button.variant.contained
                    button.size.large
                    button.disabled isLoading
                    button.children [
                        if isLoading then Mui.circularProgress [
                            circularProgress.size 20
                            circularProgress.color.inherit'
                            ] else str "Morph"
                    ]
                ]
            |}
    ]

let renderContent (state:State) (dispatch: Msg -> unit) =
    Html.form [
        prop.onSubmit (fun e -> e.preventDefault(); dispatch MakeVid)
        prop.children [
            Mui.container [
                Html.div [
                    prop.className "morph-content"
                    prop.children [
                        renderSetpoint true state.LeftValue "leftval-input" "Morph from" (SetLeftValue >> dispatch) (fun () -> ClickUploadRealImage Left |> dispatch)
                        renderSetpoint false state.RightValue "rightval-input" "Morph to" (SetRightValue >> dispatch) (fun () -> ClickUploadRealImage Right |> dispatch)
                        morphButton state.IsMorphLoading
                        renderMorph state.VidValues state.UseSlider dispatch
                    ]
                ]
            ]
        ]
    ]

let renderEncodeImageDialog  state dispatch =
    let props = { 
        OnClose = fun () -> dispatch CloseUploadDialog
        IsOpen = state.UploadDialogSide.IsSome
        RenderImgGuid = Guid >> renderImageByValue
        EncodeImageApiLocation = encodeApiAddr
        OnImageEncoded = ImageEncoded >> dispatch
    }
    encodeImageDialog props


let getShareState state =
    { 
        IsOpen = state.ShareOpen
        LinkMsg = state.ShareLinkMsg
        CanonicalUrl = canonicalUrl state
        IsShown = state.VidValues.IsSome
    }

let header =
    Html.header [
        prop.style [ style.marginBottom (length.em 2) ]
        prop.children [
            Column.column [ ] [
                Html.a [
                    prop.href "/"
                    prop.children [
                        Html.h1 [
                            prop.className "title "
                            prop.style [
                                style.custom ("fontSize", "clamp(2.5rem, 12vw, 4rem)")
                                style.display.flex
                                style.flexWrap.wrap
                                style.justifyContent.center
                                style.custom ("gap", length.em 0.5)
                            ]
                            prop.children [
                                Mui.svgIcon [
                                    prop.className "vivus-start"
                                    svgIcon.component' animatedLogo
                                    prop.style [
                                        style.fontSize (length.em 1)
                                    ]
                                ]
                                Html.span siteName
                            ]
                        ]
                    ]
                ]
            ]
        ]
    ]

let footer =
    Footer.footer [ CustomClass "app-footer" ] [
        Mui.container [
            container.maxWidth.md
            container.children [
                Html.div [
                    Html.div [
                        Html.p [
                            str "Contact: "
                            Mui.link [
                                link.color.initial
                                prop.href (sprintf "mailto:%s" contactEmail)
                                prop.text contactEmail
                            ]
                        ]
                        Html.p [
                            str "Source code: "
                            Mui.link [
                                link.color.initial
                                prop.href (sprintf "https://github.com/%s" githubRepo)
                                prop.children [
                                    gitHubIcon [ prop.style [ style.fontSize (length.em 1) ] ]
                                    str (" " + githubRepo)
                                ]
                            ]
                        ]
                        Html.p "If you find any bugs, please open an issue on GitHub"
                    ]
                    Html.div [
                        Mui.svgIcon [
                            svgIcon.component' logo
                            prop.style [
                                style.fontSize (length.rem 5)
                            ]
                        ]
                    ]
                ]
            ]
        ]
    ]

let createTheme isDark = [
    if isDark then theme.palette.type'.dark else theme.palette.type'.light
    theme.palette.background.default' <| if isDark then "#17181c" else "white"
    theme.palette.background.paper <| if isDark then "#353535" else "#fff"
    unbox<IThemeProp> ("palette.background.level2", if isDark then "#2a2a2a" else "#f5f5f5")

    let headingFamily = "'Nunito', 'Segoe UI', sans-serif"
    theme.typography.h1.fontFamily headingFamily
    theme.typography.h2.fontFamily headingFamily
    theme.typography.h3.fontFamily headingFamily
    theme.typography.h4.fontFamily headingFamily
    theme.typography.subtitle1.fontFamily headingFamily

    //everything else
    theme.typography.fontFamily "'Roboto', 'Segoe UI', sans-serif"

    theme.typography.body2.fontSize (length.rem 1)
]

let darkTheme = Styles.createMuiTheme (createTheme true)
let lightTheme = Styles.createMuiTheme (createTheme false)

let themedApp' = React.functionComponent("themed-app", fun (props: {| children: ReactElement list |}) ->
    let theme = if Hooks.useMediaQuery("@media (prefers-color-scheme: dark)") then darkTheme else lightTheme
    Mui.themeProvider [
        themeProvider.theme theme
        themeProvider.children props.children
    ])

let themedApp children = themedApp' {| children = children |}

let render (state:State) (dispatch: Msg -> unit) =
    themedApp [
        Mui.cssBaseline [ ]
        header
        renderContent state dispatch
        renderEncodeImageDialog state dispatch
        viewShareContent (getShareState state) (ShareMsg >> dispatch)
        Explain.view ()
        footer
    ]

let inline helmet props = createElement (Fable.Core.JsInterop.import "Helmet" "react-helmet") props

let meta (property:string) content =
    Html.meta [
        prop.custom ("property", property)
        prop.custom ("content", content)
    ]

let viewHead state =
    let canonicalUrl = canonicalUrl state

    helmet [ 
        prop.children [
            Html.title (pageTitle state.VidValues)
            Html.meta [
                prop.custom ("property", "description")
                prop.custom ("name", "description")
                prop.custom ("content", pageDescription None)
            ]
            meta "og:title" (pageTitle state.VidValues)
            meta "og:description" (pageDescription None)
            meta "og:site_name" siteName

            Html.link [ prop.rel.canonical; prop.href canonicalUrl ]
            meta "og:url" canonicalUrl

            match state.VidValues with
            | None -> // just use left value if no video
                meta "og:image" (imgSrc ogImgDim false state.LeftValue)
                meta "og:image:alt" (imgAlt state.LeftValue)
                meta "og:image:width" ogImgDim
                meta "og:image:height" ogImgDim
                meta "og:image:type" "image/jpeg"
                meta "og:type" "website"

            | Some vidValues ->
                let videoSrc = vidSrc ogVideoDim vidValues
                let linkprevSrc = linkpreviewSrc linkpreviewWidth vidValues
                let linkprevAlt = linkpreviewSrc linkpreviewWidth vidValues
                
                meta "og:image" linkprevSrc
                meta "og:image:alt" linkprevAlt
                meta "og:image:width" linkpreviewWidth
                meta "og:image:height" linkpreviewHeight
                meta "og:image:type" "image/jpeg"

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