module Index


open Elmish
open Elmish.React

open App


#if DEBUG
printfn "Enabled HMR"
printfn "Enabled Debugger"
open Elmish.HMR
open Elmish.Debug
#endif

Program.mkProgram init update view
|> Program.withReactSynchronous "elmish-app"
#if DEBUG
|> Program.withDebugger
#endif
|> Program.run