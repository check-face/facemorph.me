module AppState

open Checkface
open Share

type Side = | Left | Right
type State = {
    VidValues : (CheckfaceSrc * CheckfaceSrc) option
    LeftValue : CheckfaceSrc
    RightValue : CheckfaceSrc
    UploadDialogSide : Side option
    BrowseFacesDialogSide : Side option
    ShareOpen : bool
    ShareLinkMsg : string option
    IsMorphLoading : bool
    UseSlider : bool
}

type UrlState = {
    FromValue : string option
    ToValue : string option
    FromGuid : System.Guid Option
    ToGuid : System.Guid Option
    FromSeed : uint option
    ToSeed : uint option
}

type Msg =
    | SetLeftValue of CheckfaceSrc
    | SetRightValue of CheckfaceSrc
    | ClickUploadRealImage of Side
    | BrowseCheckfaceValues of Side
    | CloseUploadDialog
    | CloseBrowseFacesDialog
    | UrlChanged of (string list * Map<string, string>)
    | MakeVid
    | ShareMsg of ShareMsg
    | MorphLoaded
    | SetUseSlider of bool