module Index

open App
open Fable.React

open Fable.Core
open Fable.Core.JsInterop

printfn "Importing createEndpoint"
let createEndpoint : (string * string -> ReactElement) -> unit = import "createEndpoint" "./server.js"

printfn "Creating endpoint"
let endpoint = createEndpoint (initByUrl >> viewHead)


