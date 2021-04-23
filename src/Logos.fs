module Logos

open Fable.React

let logo : ReactElementType = Fable.Core.JsInterop.importDefault "./public/logo.svg"
let animatedLogo : ReactElementType = Fable.Core.JsInterop.importDefault "./public/logo-animated.svg"