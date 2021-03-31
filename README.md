# facemorph.me

[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/check-face/facemorph.me)

The site is written in F# using [Fable](https://fable.io/).
It uses the [CheckFace API](https://checkface.ml/api) for generating images and videos.

## Building and running the app

> Install pre-requisites: [.NET 5 SDK](https://dotnet.microsoft.com/download/dotnet/5.0), [node.js](https://nodejs.org/en/), [npm](https://www.npmjs.com/)

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
After the first compilation is finished, navigate to http://localhost:8100 in your browser to see the application.

### VS Code

If you happen to use Visual Studio Code, simply hitting F5 will start the development watch mode for you and opens your default browser navigating to http://localhost:8100.

## Vercel and SSR

After building, the `deploy` output dir is deployed to vercel.

The server generates a serverless function in api folder of the output dir.
It currently just renders the meta tags in order to make social link preview work.

As vercel doesn't support dotnet, run build first and then tell vercel the source folder is the build output, `deploy`, when setting up the project.

You usally don't need the server for development but it can be tested with the vercel cli:

```
npm run build
vercel dev
```