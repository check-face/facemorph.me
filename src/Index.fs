module Index


open Elmish
open Elmish.React

open App


#if DEBUG
printfn "Enabled HMR"
open Elmish.HMR
#endif

Program.mkProgram init update view
|> Program.withReactSynchronous "elmish-app"
|> Program.run