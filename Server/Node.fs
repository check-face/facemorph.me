module Node

open System
open Fable.Core
open Fable.Core.JS
open Fable.Core.Util

type FSPromises =
    abstract readFile : filename: string * encoding: string -> Promise<string>
    abstract readdir : path: string -> Promise<string list>

type FS =
    abstract promises : FSPromises

type Path =
    [<Emit("$0.resolve($1...)")>]
    member __.resolve([<ParamArray>] paths: string []) : string = jsNative

type IncomingMessage =
    abstract url : string
    abstract headers : obj

type URL =
    abstract hash: string  with get, set
    abstract host: string  with get, set
    abstract hostname: string  with get, set
    abstract href: string  with get, set
    abstract origin: string  
    abstract password: string  with get, set
    abstract pathname: string  with get, set
    abstract port: string  with get, set
    abstract protocol: string with get, set
    abstract search: string with get, set
    // abstract searchParams: URLSearchParams
    abstract username: string with get, set
    abstract toString: unit -> string 
    abstract toJSON: unit -> string 

type URLType =
    [<Emit("new URL($1...)")>]
    abstract Create : input: string -> URL

    [<Emit("new URL($1...)")>]
    abstract Create : input: string * base': URL -> URL

    [<Emit("new URL($1...)")>]
    abstract Create : input: string * base': string -> URL

type VercelResponse =
    abstract status : code: int -> VercelResponse
    abstract send : body: string -> VercelResponse
    abstract send : body: Buffer -> VercelResponse
    // abstract send : body: obj -> VercelResponse
    abstract json : body: obj -> VercelResponse
    abstract setHeader : name : string * value : string -> VercelResponse


[<Global>]
let __filename : string = jsNative

[<Global>]
let __dirname : string = jsNative

[<Import("*", "fs")>]
let fs : FS = jsNative

[<Import("*", "path")>]
let path : Path = jsNative

[<Import("*", "url")>]
let URL : URLType = jsNative
