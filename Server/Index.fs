module Index

open App
open Fable.React

open Fable.Core
open Fable.Core.JS
open Fable.Core.JsInterop
open System
open Node
open Bindings
open FsToolkit.ErrorHandling
open Checkface
open Config

let readIndexFile () =
    promise {
        let indexFile =
            path.resolve (__dirname, "../index.html")

        let onErr (err: obj) =
            console.error ("Something went wrong:", err)
            None

        let! fileContents =
            fs
                .promises
                .readFile(indexFile, "utf8")
                .``then``(Some)
                .catch (onErr)

        if fileContents.IsSome then
            console.log ("Success reading indexfile")
        else
            console.log ("Error reading index file")

        return fileContents
    }

let indexContents = Lazy<_>.Create readIndexFile

[<Emit("/<title>.*<\\/title>/")>]
let titleRegex : obj = jsNative

[<Emit("/<div id=\\\"elmish-app\\\"><\\/div>/")>]
let elmishAppRegex : obj = jsNative

let serverSideRender (pathName, queryString) (res:VercelResponse) =
    let initState = initByUrl (pathName, queryString)

    let dispatch = ignore
    let sheets = ServerStyleSheets()
    let appComponent =
        viewWithoutRouter initState dispatch
        |> sheets.collect

    let renderedApp =
        ReactDomServer.renderToString appComponent

    let helmet = Helmet.renderStatic ()

    let headParts =
      helmet.title.toString() + "\n" +
      helmet.meta.toString() + "\n" +
      helmet.link.toString() + "\n" +
      """<style id="jss-server-side">""" + sheets.toString() + """</style>"""

    let elmishApp = """<div id="elmish-app">""" + renderedApp + """</div>"""

    promise {
        match! indexContents.Value with
        | Some contents ->
            let body : string = contents?replace(titleRegex, headParts)?replace(elmishAppRegex, elmishApp)
            let cacheControlHeader = "max-age=3600, s-max-age=3600, stale-while-revalidate=172800"
            return res.status(200).setHeader("Cache-Control", cacheControlHeader).send(body)
        | None ->
            console.log("Oops, no contents :(");
            return res.status(500).send("Oops, better luck next time!");
    }

type ErrorCodes =
    | NotImplemented
    | BadRequest


let oembed (pathName, queryString) (baseUrl:URL) (res:VercelResponse)=
    let parseDimension dim =
        match Int32.TryParse dim with
        | true, v ->
            if v >= 50 && v <= Config.maxSupportedImgDim then Ok v
            else Error (BadRequest, "max dimension outside of acceptable range")
        | false, _ -> Error (BadRequest, "max dimension not a number")

    let (urlSegments, urlParams) = parseSegments (pathName, queryString)
    let format = urlParams.TryFind "format" |> Option.defaultValue "json"


    let response = result {
        do! Result.requireEqual format "json" (NotImplemented, "format not implemented")

        let! maxwidth = urlParams.TryFind "maxwidth" |> Option.defaultValue (Config.ogImgDim.ToString()) |> parseDimension
        let! maxheight = urlParams.TryFind "maxheight" |> Option.defaultValue (Config.ogImgDim.ToString()) |> parseDimension
        let! embedUrl = urlParams.TryFind "url" |> Result.requireSome (BadRequest, "oembed url not specified")
        let embedUrlParsed = URL.Create (embedUrl, baseUrl)

        // let isSameHost = embedUrlParsed.host = baseUrl.host
        // if not isSameHost then
        //     console.log("baseUrl", baseUrl)
        //     return! Error (BadRequest, "oembed url requested is not serviced by this API endpoint. Check your oembed configuration")


        let initState = initByUrl (embedUrlParsed.pathname, embedUrlParsed.search)
        let dim = Math.Min(maxwidth, maxheight)
        let thumbDim = Math.Min(dim, thumbnailDim)
        let (imgUrl, thumbnailUrl, title) =
            match initState.VidValues with
            | Some (fromValue, toValue) ->
                animatedWebpSrc dim (fromValue, toValue),
                imgSrc dim false fromValue,
                sprintf "%s to %s" (shortCheckfaceSrcDesc fromValue) (shortCheckfaceSrcDesc toValue)

            | None ->
                imgSrc dim true initState.LeftValue,
                imgSrc thumbDim false initState.LeftValue,
                shortCheckfaceSrcDesc initState.LeftValue

        let data = createObj [
            "version" ==> "1.0"
            "type" ==> "photo"
            "width" ==> dim
            "height" ==> dim
            "title" ==> title
            "url" ==> imgUrl
            "thumbnail_url" ==> thumbnailUrl
            "thumbnail_width" ==> thumbDim
            "thumbnail_height" ==> thumbDim
            "provider_name" ==> siteName
            "provider_url" ==> canonicalBaseUrl
        ]
        return data
    }

    promise {
        match response with
        | Ok data ->
            return res.status(200).json(data)
        | Error (statusCode, message) ->
            let status =
                match statusCode with
                | BadRequest -> 400
                | NotImplemented -> 501
            return res.status(status).send(message)
    }

let handleRequest (req: IncomingMessage) (res: VercelResponse) =
    console.log ("Got a request!")
    let baseUrl = URL.Create $"http://%s{req.headers?host}"
    let reqUrl = URL.Create (req.url, baseUrl)
    let pathName = reqUrl.pathname
    let queryString = reqUrl.search
    match pathName with
    | "/oembed.json"
    | "/oembed.json/" ->
        oembed (pathName, queryString) baseUrl res
    | _ ->
        serverSideRender (pathName, queryString) res



exportDefault handleRequest
