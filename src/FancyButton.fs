module FancyButton

open Feliz.MaterialUI
open Feliz
open Fable.Core.JsInterop

//can't use record because "@" and "%" symbols in keyframes
let private theStyles = createObj [
        "root" ==> createObj [
            "color" ==> "rgba(255,255,255,0.9)"
            "background" ==> "linear-gradient(-45deg, #FFA63D, #FF3D77, #338AFF, #3CF0C5)"
            "backgroundSize" ==> "800%"
            "animation" ==> "$anim 10s linear infinite"
            "backgroundPosition" ==> "50% 100%" //nice position if animation is not supported

        ]
        
        "@keyframes anim" ==> createObj [
            "0%" ==> createObj [ "backgroundPosition" ==> "0% 50%" ]
            "50%" ==> createObj [ "backgroundPosition" ==> "100% 50%" ]
            "100%" ==> createObj [ "backgroundPosition" ==> "0% 50%" ]
        ]
    ]

let private useStyles = Styles.makeStyles (fun styles theme -> theStyles)

[<ReactComponent>]
let FancyButton buttonProps =
    let classes = useStyles()
    Mui.button [
        button.classes.root classes?root
        yield! buttonProps
    ]