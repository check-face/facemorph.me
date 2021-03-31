module Share

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

type ShareState = {
    CanonicalUrl: string
    IsShown: bool
    LinkMsg: string option
    IsOpen: bool
}

type ShareMsg =
    | OpenShare
    | CloseShare
    | CopyLink
    | SetShareMsg of string
    | ResetShareMsg
    | NavigatorShare

let viewShareContent state dispatch =
        let encodedUrl = encodeUriComponent (state.CanonicalUrl)
        let shareButtons = [
            "Facebook", facebookIcon [ ], sprintf "https://www.facebook.com/sharer.php?display=page&u=%s&hashtag=%%23facemorph" encodedUrl
            "WhatsApp", whatsAppIcon [ ], sprintf "https://api.whatsapp.com/send?text=%s" encodedUrl
            "Twitter", twitterIcon [ ], sprintf "https://twitter.com/share?url=%s&hashtags=facemorph" encodedUrl
            "Reddit", redditIcon [ ], sprintf "https://reddit.com/submit?url=%s" encodedUrl
        ]
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
                    slide.in' state.IsShown
                    slide.direction.left
                    prop.custom ("exit", false) //disable slide on exit
                    slide.children (
                        Html.div [
                            Html.p [
                                prop.style [ style.marginBottom (length.px 10) ]
                                let message =
                                    state.LinkMsg
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
                                        speedDial.open' state.IsOpen
                                        speedDial.onOpen (fun _ _ -> dispatch OpenShare)
                                        speedDial.onClose (fun _ _ -> dispatch CloseShare)
                                        speedDial.direction.left
                                        speedDial.FabProps [
                                            prop.onClick (fun e ->
                                                e.preventDefault()
                                                if state.IsOpen
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