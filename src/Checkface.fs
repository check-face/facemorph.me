module Checkface

type CheckfaceSrc =
    | CheckfaceValue of string
    | Guid of System.Guid
    | Seed of int

type EncodeImageResponse =
    abstract did_align : bool
    abstract guid : string