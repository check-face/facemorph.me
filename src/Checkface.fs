module Checkface

type CheckfaceSrc =
    | CheckfaceValue of string
    | Guid of System.Guid
    | Seed of int

type EncodeImageResponse =
    abstract did_align : bool
    abstract guid : string

let shortCheckfaceSrcDesc = function
    | CheckfaceValue value -> value
    | Seed seed -> sprintf "seed %i" seed
    | Guid guid -> sprintf "custom (%s)" (guid.ToString().Substring(0, 6))