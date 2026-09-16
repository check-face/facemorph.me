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

if Config.isNext then
    Program.mkProgram NextProduct.init NextProduct.update NextProduct.view
    |> Program.withReactSynchronous "elmish-app"
    |> Program.run
else
    Program.mkProgram App.init App.update App.view
    |> Program.withReactSynchronous "elmish-app"
    |> Program.run
