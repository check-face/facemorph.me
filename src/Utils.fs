module Utils
open Fable.Core

let rec insert value index list =
    match index, list with
    | 0, xs -> value::xs
    | i, x::xs -> x::insert value (i - 1) xs
    | i, [] -> failwith "index out of range"

let rec remove i l =
    match i, l with
    | 0, x::xs -> xs
    | i, x::xs -> x::remove (i - 1) xs
    | i, [] -> failwith "index out of range"


[<Emit("encodeURIComponent($0)")>]
let encodeUriComponent (str:string) : string = jsNative