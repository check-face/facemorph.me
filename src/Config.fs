module Config

let videoDim = 512
let imgDim = 300
let imgSizesSet = [ 300; 512; 1024 ]
let linkpreviewWidth = 1200
let linkpreviewHeight = 628
let ogImgDim = 512
let ogVideoDim = 512

let siteName = "facemorph.me"
let canonicalBaseUrl = "https://facemorph.me"
let contactEmail = "checkfaceml@gmail.com"
let githubRepo = "check-face/facemorph.me"

let defaultTextValue = "hello"

let apiAddr = "https://api.checkface.ml"
let encodeApiAddr = apiAddr + "/api/encodeimage/"