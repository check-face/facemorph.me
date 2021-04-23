module Bindings

open Fable.React
open Fable.Core

[<Import("ServerStyleSheets", from = "@material-ui/core/styles")>]
type ServerStyleSheets() =
    member _.collect : ReactElement -> ReactElement = jsNative
    member _.toString : unit -> string = jsNative

type HelmetComponent =
    abstract toString : unit -> string
// abstract toComponent: unit -> ReactElement // or ReactProps or something if HTML or BODY
type Helmet =
    abstract title : HelmetComponent
    abstract meta : HelmetComponent
    abstract link : HelmetComponent

type HelmetModule =
    abstract renderStatic : unit -> Helmet

[<ImportDefault("react-helmet")>]
let Helmet : HelmetModule = jsNative