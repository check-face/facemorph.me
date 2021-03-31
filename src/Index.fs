module Index


open Elmish
open Elmish.React

open App


#if DEBUG
printfn "Enabled HMR"
// printfn "Enabled Debugger"
open Elmish.HMR
// open Elmish.Debug
#endif

Program.mkProgram init update view
|> Program.withReactSynchronous "elmish-app"
// debugger throws socket exceptions when redux extension is not installed.
// this makes it unusable due to https://github.com/pmmmwh/react-refresh-webpack-plugin/issues/28
// #if DEBUG
// |> Program.withDebugger
// #endif
|> Program.run