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

open FancyButton
open SliderMorph

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

type State = {
    VidValues : (string * string) option
    LeftValue : string
    RightValue : string
    ShareOpen : bool
    ShareLinkMsg : string option
    IsMorphLoading : bool
    UseSlider : bool
}

type UrlState = {
    FromValue : string option
    ToValue : string option
}

let parseUrl (path, query) =
    {
        FromValue = Map.tryFind "from_value" query
        ToValue = Map.tryFind "to_value" query    
    }


let canonicalUrl state =
    canonicalBaseUrl + Feliz.Router.Router.formatPath("/",
        [ 
            match state.VidValues with
            | Some (fromValue, toValue) ->
                "from_value", fromValue
                "to_value", toValue
            | None ->
                ()
        ])

let pageTitle = function
    | Some (fromValue, toValue) ->
        sprintf "%s to %s" fromValue toValue
    | None ->
        siteName

let pageDescription = function
    | Some (fromValue, toValue) ->
            sprintf "Morph generated faces from %s to %s" fromValue toValue
    | None ->
            "Generate faces on the fly and morph between them"

type ShareMsg =
    | OpenShare
    | CloseShare
    | CopyLink
    | SetShareMsg of string
    | ResetShareMsg
    | NavigatorShare

type Msg =
    | SetLeftValue of string
    | SetRightValue of string
    | UrlChanged of (string list * Map<string, string>)
    | MakeVid
    | ShareMsg of ShareMsg
    | MorphLoaded
    | SetUseSlider of bool

let imgSrc (dim:int) isWebp value =
    sprintf "%s/api/face/?dim=%i&value=%s&format=%s" apiAddr dim (encodeUriComponent value) (if isWebp then "webp" else "jpg")

let imgAlt value = sprintf "Generated face for value %s" value
let linkpreviewAlt (fromValue, toValue) = sprintf "%s + %s" fromValue toValue

let vidSrc (dim:int) (fromValue, toValue) =
    sprintf "%s/api/mp4/?dim=%i&from_value=%s&to_value=%s" apiAddr dim (encodeUriComponent fromValue) (encodeUriComponent toValue)

let morphframeSrc (fromValue, toValue) dim numFrames frameNum =
    sprintf "%s/api/morphframe/?dim=%i&linear=true&from_value=%s&to_value=%s&num_frames=%i&frame_num=%i" apiAddr dim (encodeUriComponent fromValue) (encodeUriComponent toValue) numFrames frameNum

let linkpreviewSrc (width:int) (fromValue, toValue) =
    sprintf "%s/api/linkpreview/?width=%i&from_value=%s&to_value=%s" apiAddr width (encodeUriComponent fromValue) (encodeUriComponent toValue)

let getCurrentPath _ =
    Browser.Dom.window.location.pathname, Browser.Dom.window.location.search

let parseSegments (pathName, queryString) =
    let urlSegments = Router.urlSegments pathName RouteMode.Path
    let urlParams =
        (Router.createUrlSearchParams queryString).entries()
        |> Seq.map (fun arr -> (arr.[0], arr.[1]))
        |> Map.ofSeq
    urlSegments, urlParams

let defaultFromValue = Option.defaultValue "hello"
let defaultToValue = Option.defaultWith (fun () -> System.DateTime.Today.ToString("yyyy-MM-dd"))

let initByUrlstate urlState =
    let vidValues = Option.map2 (fun a b -> a,b) urlState.FromValue urlState.ToValue
    {
        LeftValue = defaultFromValue urlState.FromValue
        RightValue = defaultToValue urlState.ToValue
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
        | true, Some (leftValue, rightValue) ->
            Cmd.OfPromise.result (promise {
                let fileShare = {
                    FileName = pageTitle state.VidValues + ".mp4"
                    Title = pageTitle state.VidValues
                    FileUrl = vidSrc videoDim (leftValue, rightValue)
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
    | MakeVid when state.VidValues = Some (state.LeftValue, state.RightValue) ->
        state, Cmd.none
    | MakeVid ->
        gtagEvent "MakeVid" "Video"
        state, Cmd.navigatePath("/", ["from_value", state.LeftValue; "to_value", state.RightValue])
    | UrlChanged (path, query) ->
        let urlState = parseUrl (path, query)
        let vidValues = Option.map2 (fun a b -> a,b) urlState.FromValue urlState.ToValue
        //changed and has something to be loading
        let isLoading = vidValues <> state.VidValues && vidValues.IsSome
        {
            state with
                LeftValue = defaultFromValue urlState.FromValue
                RightValue = defaultToValue urlState.ToValue
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

let renderSetpoint autoFocus value id (label:string) (onChange: string -> unit) =
    Column.column [ ] [
        Html.div [
            prop.children [
                renderImageByValue value
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
            textField.id id
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
                    prop.alt (sprintf "Morph from %s to %s" fromValue toValue)
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
                        renderSetpoint true state.LeftValue "leftval-input" "Morph from" (SetLeftValue >> dispatch)
                        renderSetpoint false state.RightValue "rightval-input" "Morph to" (SetRightValue >> dispatch)
                        morphButton state.IsMorphLoading
                        renderMorph state.VidValues state.UseSlider dispatch
                    ]
                ]
            ]
        ]
    ]

let shareContent state dispatch =
        let encodedUrl = encodeUriComponent (canonicalUrl state)
        let shareButtons = [
            "Facebook", facebookIcon [ ], sprintf "https://www.facebook.com/sharer.php?display=page&u=%s&hashtag=%%23facemorph" encodedUrl
            "WhatsApp", whatsAppIcon [ ], sprintf "https://api.whatsapp.com/send?text=%s" encodedUrl
            "Twitter", twitterIcon [ ], sprintf "https://twitter.com/share?url=%s&hashtags=facemorph" encodedUrl
            "Reddit", redditIcon [ ], sprintf "https://reddit.com/submit?url=%s" encodedUrl
        ]
        let isShown = state.VidValues.IsSome
        Html.div [
            prop.style [
                style.textAlign.right
                style.padding (length.em 2)
                style.overflow.hidden // slides in from off screen

                //use clamp as alternative to media query to remove whitespace except on small witdh
                style.custom ("marginBottom", "clamp(-2em - 45px, 5 * (700px - 100%), 0px)")
            ]
            prop.children [
                Mui.slide [
                    slide.in' isShown
                    slide.direction.left
                    prop.custom ("exit", false) //disable slide on exit
                    slide.children (
                        Html.div [
                            Html.p [
                                prop.style [ style.marginBottom (length.px 10) ]
                                let message =
                                    state.ShareLinkMsg
                                    |> Option.defaultValue "Share this morph"
                                prop.text message
                            ]
                            Mui.tooltip [
                                tooltip.title ("Copy link")
                                tooltip.placement.bottomEnd
                                tooltip.children (
                                    Mui.speedDial [
                                        speedDial.icon (
                                            Mui.speedDialIcon [
                                                speedDialIcon.icon (shareIcon [ ])
                                                speedDialIcon.openIcon (fileCopyIcon [ ])
                                            ]
                                        )
                                        speedDial.ariaLabel "Share this morph"
                                        speedDial.children [
                                            for name, icon, href in shareButtons do
                                                Mui.speedDialAction [
                                                    speedDialAction.icon icon
                                                    prop.key name
                                                    speedDialAction.tooltipTitle name
                                                    speedDialAction.tooltipPlacement.bottom
                                                    speedDialAction.FabProps [
                                                        fab.href href
                                                        prop.target "_blank"
                                                        prop.rel.noopener
                                                    ]
                                                ]
                                        ]
                                        speedDial.open' state.ShareOpen
                                        speedDial.onOpen (fun _ _ -> dispatch OpenShare)
                                        speedDial.onClose (fun _ _ -> dispatch CloseShare)
                                        speedDial.direction.left
                                        speedDial.FabProps [
                                            prop.onClick (fun e ->
                                                e.preventDefault()
                                                if state.ShareOpen
                                                then dispatch CopyLink
                                                elif navigatorCanShare
                                                then dispatch NavigatorShare
                                                else ()
                                            )
                                        ]
                                    ]
                                )
                            ]
                        ]
                    )
                ]
            ]
        ]

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
        shareContent state (ShareMsg >> dispatch)
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
            | None ->
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