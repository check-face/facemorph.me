module Checkface

open Utils
open Config


type CheckfaceSrc =
    | CheckfaceValue of string
    | Guid of System.Guid
    | Seed of uint

type EncodeImageResponse =
    abstract did_align : bool
    abstract guid : string

let (|AsNumericSeed|) =
    function
    | Seed seed -> seed
    | Guid _ -> defaultNumericSeed
    | CheckfaceValue value ->
        match System.UInt32.TryParse value with
        | true, num -> num
        | false, _ -> defaultNumericSeed

let (|AsTextValue|) =
    function
    | Seed seed -> seed.ToString()
    | CheckfaceValue value -> value
    | Guid _ -> defaultTextValue

let shortCheckfaceSrcDesc = function
    | CheckfaceValue value -> value
    | Seed seed -> sprintf "seed %i" seed
    | Guid guid -> sprintf "custom (%s)" (guid.ToString().Substring(0, 6))

let valueParam value =
    match value with
    | Guid guid -> sprintf "guid=%s" (guid.ToString())
    | CheckfaceValue value -> sprintf "value=%s" (encodeUriComponent value)
    | Seed seed -> sprintf "seed=%i" seed

let imgSrc (dim:int) isWebp value =
    sprintf "%s/api/face/?dim=%i&%s&format=%s" apiAddr dim (valueParam value) (if isWebp then "webp" else "jpg")

let vidSrc (dim:int) (fromValue, toValue) =
    sprintf "%s/api/mp4/?dim=%i&from_%s&to_%s" apiAddr dim (valueParam fromValue) (valueParam toValue)

let animatedWebpSrc (dim:int) (fromValue, toValue) =
    sprintf "%s/api/webp/?dim=%i&from_%s&to_%s" apiAddr dim (valueParam fromValue) (valueParam toValue)

let morphframeSrc (fromValue, toValue) dim numFrames frameNum =
    sprintf "%s/api/morphframe/?dim=%i&linear=true&from_%s&to_%s&num_frames=%i&frame_num=%i" apiAddr dim (valueParam fromValue) (valueParam toValue) numFrames frameNum

let linkpreviewSrc (width:int) (fromValue, toValue) =
    sprintf "%s/api/linkpreview/?width=%i&from_%s&to_%s" apiAddr width (valueParam fromValue) (valueParam toValue)


let describeCheckfaceSrc =
    function
    | CheckfaceValue value -> sprintf "value %s" value
    | Seed seed -> sprintf "seed %i" seed
    | Guid guid -> sprintf "custom latent (%s)" (guid.ToString().Substring(0, 6))

let imgAlt value =
    "Generated face for " + describeCheckfaceSrc value

let vidMorphAlt (fromValue, toValue) =
    sprintf "Morph from %s to %s" (describeCheckfaceSrc fromValue) (describeCheckfaceSrc toValue)

let linkpreviewAlt (fromValue, toValue) =
    sprintf "Preview of %s + %s" (describeCheckfaceSrc fromValue) (describeCheckfaceSrc toValue)