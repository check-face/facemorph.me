import path from 'path';
import fs from 'fs';

import ReactDOMServer from 'react-dom/server';
import Helmet from 'react-helmet'
import URL from 'url';
import { ServerStyleSheets } from '@material-ui/core/styles';

function createEndpoint(appComponentFun) {  
  const indexFile = path.resolve(__dirname, '../index.html');
  let indexContents = null;
  let didRead = false;
  return (req, res) => {
    console.log("Got a request!")
    let reqUrl = URL.parse(req.url);
    let pathName = reqUrl.pathname;
    let queryString = reqUrl.search;
    const sheets = new ServerStyleSheets();
    const appComponent = appComponentFun([pathName, queryString])
    const renderedApp = ReactDOMServer.renderToString(sheets.collect(appComponent));
    var helmet = Helmet.renderStatic();
    var headParts = `
      ${helmet.title.toString()}
      ${helmet.meta.toString()}
      ${helmet.link.toString()}
      <style id="jss-server-side">${sheets.toString()}</style>
    `;
    const appPart = `<div id="elmish-app">${renderedApp}</div>`

    let respond = contents => {
      if (contents) {
        return res.status(200).send(
          contents
            .replace(/<title>.*<\/title>/, headParts)
            .replace(/<div id=\"elmish-app\"><\/div>/, appPart)
          );
      } else {
        console.log("Oops, no contents :(");
        return res.status(500).send("Oops, better luck next time!");
      }
    };

    if (didRead /* && false */) {
      return respond(indexContents);
    } else {
      fs.readFile(indexFile, "utf8", (err, data) => {
        if (err) {
          console.error("Something went wrong:", err);
          indexContents = false;
          fs.readdir(path.resolve(__dirname, "../"), function(err, items) {
            console.log(items);
         
            for (var i=0; i<items.length; i++) {
                console.log(items[i]);
            }
          });
        } else {
          console.log("Success reading indexfile")
          indexContents = data;
        }
        didRead = true;
        return respond(indexContents);
      });
    }
  };
}

export { createEndpoint }