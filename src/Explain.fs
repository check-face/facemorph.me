module Explain

open Feliz.MaterialUI
open Feliz
open Fulma
open Fable.MaterialUI.Icons
open Fable.Core.JsInterop

let explainContent : string = Fable.Core.JsInterop.importDefault "./explain.md"

let private useStyles = Styles.makeStyles (fun styles theme ->
    {|
        expansionPanelSummary = styles.create [
            style.backgroundColor theme.palette.background.``default``
        ]
    |})

let view = React.functionComponent (fun (props : {| topMargin : int |}) ->


    let c = useStyles ()

    let parts =
        explainContent
        |> List.unfold (fun (content:string) -> 
            match content, content.IndexOf "<hr>" with
            | "", _ -> None
            | _, -1 -> Some (content, "")
            | _, idx -> Some (content.Substring(0, idx), content.Substring(idx + "<hr>".Length)))

    let topContent = parts |> List.tryHead |> Option.defaultValue ""
    let faqSections = match parts with | [ ] -> [ ] | _::tail -> tail
    let faq = [
        for part in faqSections do
            let part = part.Trim([| ' '; '\n' |])
            match part, part.LastIndexOf "</h" with
            | _, -1 -> part, None
            | _, 0 -> part, None
            | _, idx -> part.Substring(0, idx + 5), Some (part.Substring(idx + 5))
    ]


    Mui.container [
        container.maxWidth.md
        prop.style [
            style.marginTop props.topMargin
            style.marginBottom 200
        ]
        container.children [

            Content.content [ Content.Size IsLarge ] [
                Html.div [
                    prop.dangerouslySetInnerHTML topContent //rendered from markdown
                ]
            ]

            for question, answer in faq do
                Mui.expansionPanel [
                    expansionPanel.square true
                    expansionPanel.children [
                        Mui.expansionPanelSummary [
                            expansionPanelSummary.expandIcon (expandMoreIcon [ ])
                            // let theme = Styles.useTheme ()
                            // prop.style [ style.backgroundColor theme.palette.background?level2 ]
                            // prop.classes [
                            expansionPanelSummary.classes.root c.expansionPanelSummary
                            // ]
                            // prop.className 
                            // expansionPanelSummary.
                            prop.children [
                                Mui.typography [
                                    typography.component' "h3"
                                    typography.variant.h6
                                    prop.dangerouslySetInnerHTML question
                                ]
                            ]
                        ]
                        match answer with
                        | None -> ()
                        | Some answer ->
                            Mui.expansionPanelDetails [
                                Content.content [ ] [
                                    Html.div [
                                        prop.dangerouslySetInnerHTML answer
                                    ]
                                ]
                            ]
                    ]
                ]
        ]
    ])
