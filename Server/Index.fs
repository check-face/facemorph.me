module Index

open App
open Fable.React

open Fable.Core
open Fable.Core.JsInterop

printfn "Importing createEndpoint"
let createEndpoint : ReactElement -> unit = import "createEndpoint" "./server.js"

printfn "Getting initState"
let initState, _ = initByUrl ("/", Map.empty)

printfn "generating headComponents"
let headComponents = viewHead initState

printfn "Creating endpoint"
let endpoint = createEndpoint headComponents


