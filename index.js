import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

const __dirname = path.resolve();
const tmpDirectory = path.join(__dirname, "./tmp/");
const outDirectory = path.join(__dirname, "./out/");
const inputFilePath = path.join(__dirname, "input.json");

const download = async (url, filePath) => {
  return await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const request = (url.startsWith("https") ? https : http)
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
    request.setTimeout(10000, () => {
      request.socket.destroy();
      request.destroy();
      fs.unlink(filePath, () => {
        reject("socket timeout");
      });
    });
  });
};

const readFile = async (filePath) => {
  return await fs.promises.readFile(filePath, { encoding: "utf8" });
};

const writeFile = async (data, filePath) => {
  await fs.promises.writeFile(filePath, data);
  return filePath;
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
/**
 * Extracts hostname url and filename from an url
 * @param url to extract information
 * @returns {{filename: string, hostUrl: string}}
 */
const extractHostnameFilenameFromUrl = (url) => {
  const splitUrl = url.split("/");
  const hostUrl = splitUrl.slice(0, splitUrl.length - 1).join("/");
  const filename = splitUrl.pop();
  return { hostUrl, filename };
};

/**
 * downloads all segments (.ts files) and returns new m3u8
 * @param data Playlist data from Host
 * @param segmentHostUrl segmentHost url
 * @returns {Promise<string>} Playlist file with local segment paths
 */
const scanPlaylist = async (data, segmentHostUrl) => {
  const newPlaylistDataLines = [];
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/\.ts$/)) {
      // we need the segment
      const lineData = extractHostnameFilenameFromUrl(line);
      const segmentFilename = lineData.filename;
      const segmentUrl =
        lineData.hostUrl !== ""
          ? `${lineData.hostUrl}/${segmentFilename}`
          : `${segmentHostUrl}/${segmentFilename}`;
      // check if file exists
      const segmentFilepath = path.join(tmpDirectory, segmentFilename);
      if (fs.existsSync(segmentFilepath)) {
        console.log(`file already exists: ${segmentFilename}`);
      } else {
        while (1) {
          try {
            console.log(`downloading ${segmentFilename}`);
            await download(segmentUrl, segmentFilepath);
            break;
          } catch (e) {
            console.error(e);
          }
        }
      }
      newPlaylistDataLines.push(segmentFilepath);
    } else {
      newPlaylistDataLines.push(line);
    }
  }
  return newPlaylistDataLines.join("\n");
};

async function mergeSegments(command, output) {
  await new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      const logFilepath = path.join(outDirectory, output + ".log");
      if (error)
        fs.writeFile(logFilepath, stderr, () => {
          reject(error);
        });
      else
        fs.writeFile(logFilepath, stdout, () => {
          resolve();
        });
    });
  });
}

function validateInputFile(json) {
  // check if streams property exists
  const streams = json.streams;
  let isValide = !!streams;

  // check properties of stream is valide
  if (isValide) {
    for (let i in streams) {
      const stream = streams[i];
      if (!isValide) break;
      isValide = !!stream.url && !!stream.output;
    }
  }

  return isValide;
}

function getInputFile() {
  if (!fs.existsSync(inputFilePath)) {
    throw new Error(`Input file not found at ${inputFilePath}`);
  }
  const json = JSON.parse(fs.readFileSync(inputFilePath));
  if (!validateInputFile(json)) {
    throw new Error(
      `Input file doesn't contain all needed values or is invalide`
    );
  }
  return json;
}

async function createWorkFolders() {
  if (!fs.existsSync(tmpDirectory)) {
    console.log(`create ./tmp directory`);
    await fs.promises.mkdir(tmpDirectory);
  }

  if (!fs.existsSync(outDirectory)) {
    console.log(`create ./out directory`);
    await fs.promises.mkdir(outDirectory);
  }
}

async function collectSegments(stream) {
  const { url, output } = stream;
  console.log(`processing ${output}`);
  await createWorkFolders();

  // find host and filename from url
  const masterPlaylistData = extractHostnameFilenameFromUrl(url);
  const masterFilename = masterPlaylistData.filename;
  const host = masterPlaylistData.hostUrl;

  const masterFilepath = await download(
    url,
    path.join(tmpDirectory, masterFilename)
  );
  // read file and queue downloads of inner files
  const masterData = await readFile(masterFilepath);
  // find first playlist file
  const playlistUrl = scanMasterPlaylist(masterData);

  let playListFilenameData = extractHostnameFilenameFromUrl(playlistUrl);
  // Extracts host url from playlsit file
  const playlistHost =
    playListFilenameData.hostUrl !== "" ? playListFilenameData.hostUrl : host;
  const playlistFilenameUrl = `${playlistHost}/${playListFilenameData.filename}`;
  // Extracts playlist name from master file
  const playlistFilename = playListFilenameData.filename;

  // download it
  const playlistFilepath = await download(
    playlistFilenameUrl,
    path.join(tmpDirectory, playlistFilename)
  );
  // read file
  const playlistData = await readFile(playlistFilepath);
  // download needed .ts files
  const newPlaylistData = await scanPlaylist(playlistData, playlistHost);
  const newPlaylistFilepath = await writeFile(
    newPlaylistData,
    `./tmp/local_${playlistFilename}`
  );
  return { output, newPlaylistFilepath };
}

(async () => {
  const { streams } = getInputFile();
  for (const stream of streams) {
    const { output, newPlaylistFilepath } = await collectSegments(stream);
    console.log(`done writing to ${newPlaylistFilepath}`);
    const command = `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto -i ${newPlaylistFilepath} -c copy "${path.join(
      outDirectory,
      output
    )}"`;
    console.log(`now executing ${command}`);
    await mergeSegments(command, output);
    // clean tmp directory
    if (fs.existsSync(tmpDirectory)) {
      console.log(`clean ./tmp directory`);
      await fs.promises.rm(tmpDirectory, { recursive: true });
    }
  }
})();
