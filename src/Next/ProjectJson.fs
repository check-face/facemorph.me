namespace CheckFace.Next

open System
open System.Globalization
open System.Text
open Contracts

/// Explicit, bounded project-file codec shared by .NET and Fable. No runtime events are deserialized.
module ProjectJson =
    [<Literal>]
    let MaxInputChars = 16777216
    [<Literal>]
    let MaxControls = 64
    [<Literal>]
    let MaxLatentValues = 65536

    type private Json = Object of Map<string, Json> | Array of Json list | Text of string | Number of float | Boolean of bool | Null
    let private invalid message = failwith message
    let private finite n = not (Double.IsInfinity n || Double.IsNaN n)

    let private parse (input: string) =
        if isNull input || input.Length > MaxInputChars then invalid "Project exceeds the input size limit."
        let mutable offset = 0
        let mutable nodes = 0
        let peek () = if offset < input.Length then input.[offset] else '\000'
        let consume expected =
            if peek() <> expected then invalid "Malformed JSON."
            offset <- offset + 1
        let whitespace () =
            while offset < input.Length && (peek() = ' ' || peek() = '\n' || peek() = '\r' || peek() = '\t') do
                offset <- offset + 1
        let hex c =
            if c >= '0' && c <= '9' then int c - int '0'
            elif c >= 'a' && c <= 'f' then int c - int 'a' + 10
            elif c >= 'A' && c <= 'F' then int c - int 'A' + 10
            else invalid "Invalid JSON Unicode escape."
        let stringValue () =
            consume '"'
            let value = StringBuilder()
            while peek() <> '"' do
                if offset >= input.Length then invalid "Unterminated JSON string."
                let c = peek()
                offset <- offset + 1
                if c = '\\' then
                    let escaped = peek()
                    offset <- offset + 1
                    match escaped with
                    | '"' | '\\' | '/' -> value.Append(escaped) |> ignore
                    | 'b' -> value.Append('\b') |> ignore
                    | 'f' -> value.Append('\f') |> ignore
                    | 'n' -> value.Append('\n') |> ignore
                    | 'r' -> value.Append('\r') |> ignore
                    | 't' -> value.Append('\t') |> ignore
                    | 'u' ->
                        if offset + 4 > input.Length then invalid "Truncated JSON Unicode escape."
                        let mutable code = 0
                        for i in 0 .. 3 do code <- code * 16 + hex input.[offset + i]
                        offset <- offset + 4
                        value.Append(char code) |> ignore
                    | _ -> invalid "Invalid JSON escape."
                elif int c < 32 then invalid "Unescaped control character."
                else value.Append(c) |> ignore
                if value.Length > 4096 then invalid "JSON string exceeds the limit."
            consume '"'
            value.ToString()
        let digit c = c >= '0' && c <= '9'
        let numberValue () =
            let start = offset
            if peek() = '-' then offset <- offset + 1
            if peek() = '0' then offset <- offset + 1
            else
                if not (digit (peek())) then invalid "Invalid JSON number."
                while digit (peek()) do offset <- offset + 1
            if peek() = '.' then
                offset <- offset + 1
                if not (digit (peek())) then invalid "Invalid JSON fraction."
                while digit (peek()) do offset <- offset + 1
            if peek() = 'e' || peek() = 'E' then
                offset <- offset + 1
                if peek() = '+' || peek() = '-' then offset <- offset + 1
                if not (digit (peek())) then invalid "Invalid JSON exponent."
                while digit (peek()) do offset <- offset + 1
            if offset - start > 128 then invalid "JSON number exceeds the limit."
            let token = input.Substring(start, offset - start)
#if FABLE_COMPILER
            let value = Double.Parse(token)
#else
            let value = Double.Parse(token, NumberStyles.Float, CultureInfo.InvariantCulture)
#endif
            if not (finite value) then invalid "JSON number must be finite."
            Number value
        let literal word value =
            for c in word do consume c
            value
        let rec read depth =
            if depth > 16 then invalid "Project exceeds the nesting limit."
            nodes <- nodes + 1
            if nodes > 1000000 then invalid "Project exceeds the value count limit."
            whitespace()
            match peek() with
            | '"' -> Text (stringValue())
            | '[' ->
                consume '['
                whitespace()
                let values = ResizeArray<Json>()
                if peek() <> ']' then
                    values.Add(read (depth + 1))
                    whitespace()
                    while peek() = ',' do
                        consume ','
                        if values.Count >= MaxLatentValues then invalid "JSON array exceeds the limit."
                        values.Add(read (depth + 1))
                        whitespace()
                consume ']'
                Array (List.ofSeq values)
            | '{' ->
                consume '{'
                whitespace()
                let mutable fields = Map.empty
                let field () =
                    whitespace()
                    let key = stringValue()
                    if Map.containsKey key fields then invalid "Duplicate JSON field."
                    whitespace()
                    consume ':'
                    fields <- Map.add key (read (depth + 1)) fields
                    if fields.Count > 32 then invalid "JSON object exceeds the field limit."
                    whitespace()
                if peek() <> '}' then
                    field()
                    while peek() = ',' do consume ','; field()
                consume '}'
                Object fields
            | 't' -> literal "true" (Boolean true)
            | 'f' -> literal "false" (Boolean false)
            | 'n' -> literal "null" Null
            | '-' -> numberValue()
            | c when digit c -> numberValue()
            | _ -> invalid "Malformed JSON value."
        let result = read 0
        whitespace()
        if offset <> input.Length then invalid "Trailing JSON content."
        result

    let private fields expected = function
        | Object values when (values |> Map.toList |> List.map fst |> Set.ofList) = Set.ofList expected -> values
        | _ -> invalid "Missing or unknown project fields."
    let private text = function Text value -> value | _ -> invalid "Expected string."
    let private number = function Number value -> value | _ -> invalid "Expected number."
    let private integer value =
        let n = number value
        if n < 0. || n > float Int32.MaxValue || floor n <> n then invalid "Expected nonnegative integer."
        int n
    let private boolean = function Boolean value -> value | _ -> invalid "Expected boolean."
    let private array = function Array value -> value | _ -> invalid "Expected array."
    let spaceName = function
        | Z -> "z"
        | W -> "w"
        | WPlus -> "w-plus"
    let private space = function
        | "z" -> Z
        | "w" -> W
        | "w-plus" -> WPlus
        | _ -> invalid "Unknown latent space."
    let kindName = function
        | Linear -> "linear"
        | PairwiseEllipse -> "pairwise-ellipse"
        | PairwiseFigure8 -> "pairwise-figure8"
        | FullSmoothEllipse -> "full-smooth-ellipse"
        | FullSmoothFigure8 -> "full-smooth-figure8"
    let private kind = function
        | "linear" -> Linear
        | "pairwise-ellipse" -> PairwiseEllipse
        | "pairwise-figure8" -> PairwiseFigure8
        | "full-smooth-ellipse" -> FullSmoothEllipse
        | "full-smooth-figure8" -> FullSmoothFigure8
        | _ -> invalid "Unknown morph kind."
    let private bounds (project: Project) =
        [
            if project.Morph.Controls.Length > MaxControls then yield "Project exceeds 64 controls."
            if (project.Morph.Controls |> List.sumBy (fun c -> c.Latent.Values.Length)) > 900000 then
                yield "Project exceeds the total latent value limit."
            if project.Morph.Controls |> List.exists (fun c -> c.Latent.Values.Length > MaxLatentValues || c.Latent.Shape.Length > 8) then
                yield "Latent exceeds dimension/value limits."
            if project.Morph.FramesPerSegment > 100000 then yield "Frame schedule exceeds the limit."
            let strings = [project.Bundle.Version; project.Morph.AlgorithmVersion] @ (project.Morph.Controls |> List.map (fun c -> c.VisitId))
            if strings |> List.exists (fun s -> not (isNull s) && s.Length > 4096) then yield "String exceeds the limit."
        ]
    let decode input : Result<Project, string list> =
        try
            let root = parse input |> fields ["schemaVersion"; "bundle"; "modelSha256"; "noiseSha256"; "truncationPsi"; "truncationCutoff"; "morph"]
            let schema = integer root.["schemaVersion"]
            if schema <> 1 then invalid "Unsupported project schema."
            let bundle = fields ["version"; "manifestSha256"] root.["bundle"]
            let morph = fields ["algorithmVersion"; "kind"; "controls"; "closed"; "width"; "pinchCenter"; "framesPerSegment"; "framesPerSecond"] root.["morph"]
            let controls = array morph.["controls"]
            if controls.Length > MaxControls then invalid "Project exceeds 64 controls."
            let project = {
                SchemaVersion = schema
                Bundle = { Version = text bundle.["version"]; ManifestSha256 = text bundle.["manifestSha256"] }
                ModelSha256 = text root.["modelSha256"]
                NoiseSha256 = text root.["noiseSha256"]
                TruncationPsi = number root.["truncationPsi"]
                TruncationCutoff = integer root.["truncationCutoff"]
                Morph = {
                    AlgorithmVersion = text morph.["algorithmVersion"]
                    Kind = kind (text morph.["kind"])
                    Controls = controls |> List.map (fun value ->
                        let control = fields ["visitId"; "latent"] value
                        let latent = fields ["space"; "shape"; "values"] control.["latent"]
                        { VisitId = text control.["visitId"]; Latent = { Space = space (text latent.["space"]); Shape = array latent.["shape"] |> List.map integer; Values = array latent.["values"] |> List.map number } })
                    Closed = boolean morph.["closed"]
                    Width = number morph.["width"]
                    PinchCenter = boolean morph.["pinchCenter"]
                    FramesPerSegment = integer morph.["framesPerSegment"]
                    FramesPerSecond = integer morph.["framesPerSecond"]
                }
            }
            match validate project @ bounds project with [] -> Ok project | errors -> Error errors
        with _ -> Error ["Invalid or unsupported project JSON; check its schema, fields, values and size limits."]

    let private quote (value: string) =
        let builder = StringBuilder("\"")
        for c in value do
            match c with
            | '"' -> builder.Append("\\\"") |> ignore
            | '\\' -> builder.Append("\\\\") |> ignore
            | c when int c < 32 || (int c >= 0xD800 && int c <= 0xDFFF) ->
                let code = int c
                builder.Append("\\u") |> ignore
                for shift in [12; 8; 4; 0] do
                    builder.Append("0123456789abcdef".[(code >>> shift) &&& 15]) |> ignore
            | _ -> builder.Append(c) |> ignore
        builder.Append('"').ToString()
    let private numeric (value: float) = value.ToString("R", CultureInfo.InvariantCulture)
    let private jsonArray values = "[" + String.concat "," values + "]"
    let private jsonObject values = "{" + (values |> List.map (fun (k,v) -> quote k + ":" + v) |> String.concat ",") + "}"
    let private boolValue value = if value then "true" else "false"

    let encode (project: Project) : Result<string, string list> =
        match validate project @ bounds project with
        | errors when not errors.IsEmpty -> Error errors
        | _ ->
            let morph = project.Morph
            let value = jsonObject [
                "schemaVersion", "1"
                "bundle", jsonObject ["version", quote project.Bundle.Version; "manifestSha256", quote project.Bundle.ManifestSha256]
                "modelSha256", quote project.ModelSha256
                "noiseSha256", quote project.NoiseSha256
                "truncationPsi", numeric project.TruncationPsi
                "truncationCutoff", string project.TruncationCutoff
                "morph", jsonObject [
                    "algorithmVersion", quote morph.AlgorithmVersion
                    "kind", quote (kindName morph.Kind)
                    "controls", morph.Controls |> List.map (fun c -> jsonObject [
                        "visitId", quote c.VisitId
                        "latent", jsonObject ["space", quote (spaceName c.Latent.Space); "shape", c.Latent.Shape |> List.map string |> jsonArray; "values", c.Latent.Values |> List.map numeric |> jsonArray]
                    ]) |> jsonArray
                    "closed", boolValue morph.Closed
                    "width", numeric morph.Width
                    "pinchCenter", boolValue morph.PinchCenter
                    "framesPerSegment", string morph.FramesPerSegment
                    "framesPerSecond", string morph.FramesPerSecond
                ]
            ]
            if value.Length > MaxInputChars then Error ["Project exceeds the input size limit."] else Ok value
