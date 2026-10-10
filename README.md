# facemorph.me

[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/check-face/facemorph.me)

The site is written in F# using [Fable](https://fable.io/).
The historical frontend uses the CheckFace API for generating images and videos.
The current candidate frontend at **https://next.facemorph.me** performs inference
locally and does **not** use that API.

## Run your own API

[Self-host with Docker](self-host/README.md): NVIDIA GPU or CPU, the original UI,
verified model downloads, and persistent saved faces. See the [API reference](docs/api.md).

This package preserves the historical server API and builds its original frontend
from pinned commit `0abb215f27b16e17e3919cf78b616b6ae4998a5d`. The current
`candidate/next-delivery-20260916` frontend at `next.facemorph.me` runs inference
locally and does **not** use this API. Sharing a repository does not make the
self-host API a dependency of the current web or desktop application.

## Building and running the classic app

These commands build the historical application. The current candidate uses
`npm ci` and `npm run build:next`, with output in `deploy-next/`. The Docker
self-host package independently builds its pinned historical frontend.

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