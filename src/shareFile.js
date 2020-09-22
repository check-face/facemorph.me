function shareFile(fileShare) {
    console.log("Sharing is caring", fileShare)
    return fetch(fileShare.FileUrl)
        .then(response => {
            return response.blob()
        })
        .then(blob => {
            var file = new File([blob], fileShare.FileName, { type: fileShare.ContentType });
            var files = [file];

            const data = {
                text: fileShare.Text,
                files: files,
                title: fileShare.Title,
                url: fileShare.Url
            };

            const dataNoFiles = {
                text: fileShare.Text,
                title: fileShare.Title,
                url: fileShare.Url
            };

            if (typeof navigator !== "undefined" && navigator.canShare) {
                if(navigator.canShare(data)) {
                   navigator.share(data); //ignore result
                   return true
               }
               else if(navigator.canShare(dataNoFiles)) {
                   navigator.share(dataNoFiles); //ignore result
                   return true
               }  
            }
            return false;
        })
        .catch(err => {
            console.log(err);
            //in case it fails fetching file, still try sharing the link
            const dataNoFiles = {
                text: fileShare.Text,
                title: fileShare.Title,
                url: fileShare.Url
            };
            if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare(dataNoFiles)) {
                navigator.share(dataNoFiles); //ignore result
                return true
            }
            return false;
        })
}
export { shareFile }