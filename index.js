import http from "http";
import https from "https";
import fs from "fs";
import path from "path";

const __dirname = path.resolve();

const download = async (url, filePath) => {
  return await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    (url.startsWith("https") ? https : http)
      .get(url)
      .on("response", (res) => {
        res.pipe(file);
        file.on("finish", () => {
          resolve(filePath);
        });
      })
      .on("error", (err) => {
        fs.unlink(filePath, () => {
          reject(err);
        });
      });
  });
};

const readFile = async (filePath) => {
  return await fs.promises.readFile(filePath, { encoding: "utf8" });
};

const writeFile = async (data, filePath) => {
  return await fs.promises.writeFile(filePath, data);
};

// returns first playlist file
const scanMasterPlaylist = (data) => {
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/\.m3u8$/)) {
      return line;
    }
  }
};

// downloads all segments (.ts files) and returns new m3u8
const scanPlaylist = async (data) => {
  const newPlaylistDataLines = [];
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/\.ts$/)) {
      // download the segment
      const segmentFilename = line.match(/.*\/(.*)$/)[1];
      console.log(`downloading ${segmentFilename}`);
      const segmentPath = await download(
        line,
        path.join(__dirname, `./tmp/${segmentFilename}`)
      );
      newPlaylistDataLines.push(segmentPath);
    } else {
      newPlaylistDataLines.push(line);
    }
  }
  return newPlaylistDataLines.join("\n");
};

const url = "...";

(async () => {
  try {
    // find host and filename from url
    const match = url.match(/(.*)\/(.*)$/);
    const host = match[1] + "/";
    const masterFilename = match[2];
    const masterFilepath = await download(
      url,
      path.join(__dirname, `./tmp/${masterFilename}`)
    );
    // read file and queue downloads of inner files
    const masterData = await readFile(masterFilepath);
    // find first playlist file
    const playlistFilename = scanMasterPlaylist(masterData);
    // download it
    const playlistFilepath = await download(
      `${host}/${playlistFilename}`,
      path.join(__dirname, `./tmp/${playlistFilename}`)
    );
    // read file
    const playlistData = await readFile(playlistFilepath);
    // download needed .ts files
    const newPlaylistData = await scanPlaylist(playlistData);
    await writeFile(newPlaylistData, `./tmp/local_${playlistFilename}`);
    console.log(`done writing`);
  } catch (e) {
    console.error(e);
  }
})();
