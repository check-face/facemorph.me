module Index

open App
open Fable.React

open Fable.Core
open Fable.Core.JS
open Fable.Core.JsInterop
open System
open Node
open Bindings

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

let handleRequest (req: IncomingMessage, res: VercelResponse) =
    console.log ("Got a request!")
    let reqUrl = URL.Create (req.url, $"http://%s{req.headers?host}")
    let pathName = reqUrl.pathname
    let queryString = reqUrl.search
    let sheets = ServerStyleSheets()
    let initState = initByUrl (pathName, queryString)
    let dispatch = ignore

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
            return res.status(200).send(body)
        | None ->
            console.log("Oops, no contents :(");
            return res.status(500).send("Oops, better luck next time!");
    }