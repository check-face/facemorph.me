[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/check-face/facemorph.me)

# Elmish Getting Started

This is a simple Fable application including an [Elmish](https://elmish.github.io/) counter. The repository is made for learning purposes and the generated Javascript output is not optimized. That said, the template shows you how easy it is to get started with Fable and Elmish using minimal configuration.

## Building and running the app

First of all, start with installing the project's npm dependencies
```bash
npm install
```
Once this is finished, you can then build and compile the project:
```
npm run build
```
You can start developing the application in watch mode using the webpack development server:
```
npm start
```
After the first compilation is finished, navigate to http://localhost:8080 in your browser to see the application.

### VS Code

If you happen to use Visual Studio Code, simply hitting F5 will start the development watch mode for you and opens your default browser navigating to http://localhost:8080.


## Vercel and SSR

After building, the `deploy` output dir is deployed to vercel.

The server generates a serverless function in api folder of the output dir.
It currently just renders the meta tags in order to make social link preview work.