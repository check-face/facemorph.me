// module KeyLatents

// open Elmish
// open Elmish.React
// open Feliz
// open Feliz.MaterialUI
// open Fable.MaterialUI.Icons
// open Fable.React
// open Fable.React.Props
// open Utils

// type Msg =
//     | SetValue of string
//     | AddNew
//     | Remove

// let render (value: string) (dispatch: Msg -> unit) =
//     Mui.grid [
//         prop.className "key-latent-frame"
//         grid.container true
//         grid.direction.row
//         grid.spacing._3
//         grid.children [
//             Mui.grid [
//                 grid.item true
//                 grid.children [
//                     Mui.textField [
//                         textField.value value
//                         textField.onChange (SetValue >> dispatch)
//                         textField.fullWidth true
//                     ]
//                 ]

//             ]

//             Mui.grid [
//                 grid.item true
//                 grid.xs._6
//                 grid.children [
                    
//                     img [
//                         let imgSrc = sprintf "https://api.checkface.ml/api/face/?dim=300&value=%s" (encodeUriComponent value)
//                         Src imgSrc
//                     ]
//                 ]

//             ]


//             Mui.grid [
//                 grid.item true
//                 grid.children [

//                     Mui.iconButton [
//                         iconButton.color.primary
//                         prop.onClick (fun _ -> dispatch AddNew)
//                         iconButton.type'.button
//                         iconButton.children [ personAddIcon [] ]
//                     ]
//                 ]

//             ]

//             Mui.grid [
//                 grid.item true
//                 grid.children [
//                     Mui.iconButton [
//                         iconButton.color.secondary
//                         prop.onClick (fun _ -> dispatch Remove)
//                         iconButton.type'.button
//                         iconButton.children [ deleteIcon [] ]
//                     ]
//                 ]
//             ]


//         ]
//     ]