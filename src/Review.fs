module Review

open Feliz
open Fable.React
open Feliz.MaterialUI
open Config
open AppState

let invitation =
    let ready = isClassicReview || trialInvitationUrl <> ""
    Html.aside [
        prop.className "chapter-banner"
        prop.ariaLabel "Facemorph community transition"
        prop.children [
            Html.h2 "Facemorph’s next chapter"
            Html.p (if ready then "Try the new experience alongside classic Facemorph. We’re moving this community project toward a mostly archival future, with a way to make new faces using your own Hugging Face allowance."
                    else "We’re preparing a new experience for this community project: a mostly archival home, with a way to make new faces using your own Hugging Face allowance.")
            Html.p "Classic will remain available during a side-by-side trial of at least four weeks. We’ll review the results and preservation work before retiring the current API."
            if ready then
                Html.a [
                    prop.className "chapter-action"
                    prop.href (if isClassicReview then "/?from_seed=42&to_seed=5" else trialInvitationUrl)
                    prop.text "Try the new experience"
                ]
            Html.a [ prop.href "/retirement"; prop.text "What’s changing" ]
        ]
    ]

let reviewNavigation =
    Html.aside [
        prop.className "review-nav"
        prop.ariaLabel "Local review navigation"
        prop.children [
            Html.strong "Local proposal · not published"
            Html.a [ prop.href "/classic?from_seed=42&to_seed=5"; prop.text "Classic + draft banner" ]
            Html.a [ prop.href "/?from_seed=42&to_seed=5"; prop.text "New experience" ]
            Html.a [ prop.href "/retirement"; prop.text "Transition page" ]
        ]
    ]

let view (state: State) dispatch =
    Mui.container [
        prop.children [
            if isReview then reviewNavigation
            if isClassicReview then
                invitation
                Html.p [ prop.className "review-note"; prop.text "Classic-page layout preview. Both local views use the same local renderer; this is not a comparison with the live GPU." ]
            else
                Html.section [
                    prop.className "chapter-intro"
                    prop.children [
                        Html.h2 "Familiar faces. Your own compute."
                        Html.p "Explore saved faces without signing in. When you want to make something new, use your own Hugging Face account and its free allowance or paid resources."
                        Html.p "Choose two words or seeds and press Morph. We check saved results first. New results are public; please don’t enter private information."
                        Html.a [ prop.href (if isReview then "/classic?from_seed=42&to_seed=5" else "https://facemorph.me"); prop.text "Back to classic" ]
                        str " · "
                        Html.a [ prop.href "/retirement"; prop.text "About the side-by-side trial" ]
                    ]
                ]
            if isReview then
                Html.section [
                    prop.className "compute-card"
                    prop.ariaLabel "Demo account and compute"
                    prop.children [
                        Html.h3 "Your Hugging Face compute"
                        Html.p [ prop.className "review-note"; prop.text "DEMO CONTROLS · No HF login, balance or billing is connected. Generation runs on this Mac’s CPU. Choose a state to walk through the proposal." ]
                        Html.div [
                            prop.role "group"
                            prop.ariaLabel "Preview account state"
                            prop.className "demo-states"
                            prop.children [
                                for mode, label in ["signed-out", "Signed out"; "free", "Free allowance"; "paid", "Paid resources"; "exhausted", "Allowance exhausted"] do
                                    Mui.button [
                                        prop.text label
                                        prop.ariaPressed (state.DemoMode = mode)
                                        button.variant.outlined
                                        button.color.primary
                                        prop.disabled state.IsMorphLoading
                                        prop.onClick (fun _ -> dispatch (SetDemoMode mode))
                                    ]
                            ]
                        ]
                        Html.p (
                            match state.DemoMode with
                            | "free" -> "You’re using your own free allowance. A new generation would use your HF compute; reopening saved results uses none."
                            | "paid" -> "You’ve chosen your own paid HF resources. Any purchase happens with HF; Facemorph does not charge you or automatically upgrade you."
                            | "exhausted" -> "No allowance remains in this demo state. You can still browse saved results. For new work, wait for a reset or choose paid resources through HF."
                            | _ -> "Sign in to generate new faces using your own resources. Saved faces and morphs remain available without an account.")
                    ]
                ]
            elif not isLocalPreview then
                Html.a [ prop.href "/login/huggingface?_target_url=%2F"; prop.text "Sign in with Hugging Face" ]
            else
                Html.p "Local CPU preview; HF is not connected."
            Html.p [ prop.className "review-note"; prop.text "Early preview: seven preserved seed samples, new word/seed faces and short GIFs. Photo uploads, historic photo links and the full archive have not moved. New renderings may differ from classic." ]
            match state.TrialStatus with
            | Some message -> Html.p [ prop.className "compute-status"; prop.role "status"; prop.text message ]
            | None -> Html.p [ prop.className "compute-status"; prop.role "status"; prop.text "Saved results open without compute. To try a new request, change an input and press Morph." ]
        ]
    ]
